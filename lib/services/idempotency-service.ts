import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildIdempotencyRequestHash,
  buildIdempotencyScopeHash,
  buildReplaySnapshot,
  FINANCIAL_IDEMPOTENCY_OPERATIONS,
  formatTerminalScope,
  hashIdempotencyKey,
  IDEMPOTENCY_REPLAY_WINDOW_MS,
  isIdempotencyReplayExpired,
  type FinancialIdempotencyOperation,
} from "@/lib/security/idempotency";

export class IdempotencyConflictError extends Error {
  readonly code:
    | "IDEMPOTENCY_PAYLOAD_MISMATCH"
    | "IDEMPOTENCY_KEY_EXPIRED"
    | "IDEMPOTENCY_IN_PROGRESS";

  constructor(
    code:
      | "IDEMPOTENCY_PAYLOAD_MISMATCH"
      | "IDEMPOTENCY_KEY_EXPIRED"
      | "IDEMPOTENCY_IN_PROGRESS",
    message: string,
  ) {
    super(message);
    this.name = "IdempotencyConflictError";
    this.code = code;
  }
}

export type FinancialIdempotentResult<T> = {
  status: number;
  body: T;
  replayed: boolean;
  responseBody: string;
};

type IdempotencyClient = Pick<
  typeof prisma,
  "idempotencyRecord" | "$transaction"
>;

function assertSupportedOperation(
  operation: string,
): asserts operation is FinancialIdempotencyOperation {
  if (
    !(FINANCIAL_IDEMPOTENCY_OPERATIONS as readonly string[]).includes(operation)
  ) {
    throw new Error("Unsupported financial idempotency operation");
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function loadCompletedReplay<T>(
  client: IdempotencyClient,
  scopeHash: string,
  requestHash: string,
  now: Date,
): Promise<FinancialIdempotentResult<T> | null> {
  const existing = await client.idempotencyRecord.findUnique({
    where: { scopeHash },
  });
  if (!existing) return null;

  if (existing.requestHash !== requestHash) {
    throw new IdempotencyConflictError(
      "IDEMPOTENCY_PAYLOAD_MISMATCH",
      "Idempotency-Key was reused with a different request",
    );
  }

  if (existing.state === "IN_PROGRESS") {
    throw new IdempotencyConflictError(
      "IDEMPOTENCY_IN_PROGRESS",
      "Idempotent request is already in progress; retry with the same key",
    );
  }

  if (existing.state !== "COMPLETED" || !existing.responseBody || !existing.responseStatus) {
    throw new IdempotencyConflictError(
      "IDEMPOTENCY_IN_PROGRESS",
      "Idempotent request is already in progress; retry with the same key",
    );
  }

  if (isIdempotencyReplayExpired(existing.expiresAt, now)) {
    throw new IdempotencyConflictError(
      "IDEMPOTENCY_KEY_EXPIRED",
      "Idempotency-Key replay window has expired; confirm business state and use a new key",
    );
  }

  const parsed = JSON.parse(existing.responseBody) as {
    success: true;
    data: T;
  };
  return {
    status: existing.responseStatus,
    body: parsed.data,
    replayed: true,
    responseBody: existing.responseBody,
  };
}

/**
 * Execute a protected financial mutation exactly once per scoped idempotency key.
 * Reservation, mutation, required audit (inside execute), and completed snapshot
 * share one Prisma interactive transaction.
 */
export async function executeFinancialIdempotent<T>(input: {
  rawKey: string;
  operation: FinancialIdempotencyOperation;
  resourceType: "orders";
  resourceId: number;
  actorUserId: number;
  authoritativeTerminalId: number | null;
  /** Strict validated business DTO only. */
  requestPayload: unknown;
  now?: Date;
  client?: IdempotencyClient;
  execute: (
    tx: Prisma.TransactionClient,
  ) => Promise<{ status: number; body: T }>;
}): Promise<FinancialIdempotentResult<T>> {
  assertSupportedOperation(input.operation);

  const client = input.client ?? prisma;
  const now = input.now ?? new Date();
  const keyDigest = hashIdempotencyKey(input.rawKey);
  const requestHash = buildIdempotencyRequestHash({
    operation: input.operation,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    payload: input.requestPayload,
  });
  const scopeHash = buildIdempotencyScopeHash({
    actorUserId: input.actorUserId,
    authoritativeTerminalId: input.authoritativeTerminalId,
    operation: input.operation,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    keyDigest,
  });
  const terminalScope = formatTerminalScope(input.authoritativeTerminalId);

  const existingReplay = await loadCompletedReplay<T>(
    client,
    scopeHash,
    requestHash,
    now,
  );
  if (existingReplay) return existingReplay;

  try {
    return await client.$transaction(async (tx) => {
      await tx.idempotencyRecord.create({
        data: {
          scopeHash,
          keyDigest,
          requestHash,
          operation: input.operation,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          actorUserId: input.actorUserId,
          terminalScope,
          state: "IN_PROGRESS",
        },
      });

      const result = await input.execute(tx);
      const snapshot = buildReplaySnapshot({
        status: result.status,
        body: result.body,
      });
      const expiresAt = new Date(now.getTime() + IDEMPOTENCY_REPLAY_WINDOW_MS);

      await tx.idempotencyRecord.update({
        where: { scopeHash },
        data: {
          state: "COMPLETED",
          responseStatus: snapshot.responseStatus,
          responseBody: snapshot.responseBody,
          completedAt: now,
          expiresAt,
        },
      });

      return {
        status: result.status,
        body: result.body,
        replayed: false,
        responseBody: snapshot.responseBody,
      };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;

    const replay = await loadCompletedReplay<T>(
      client,
      scopeHash,
      requestHash,
      now,
    );
    if (replay) return replay;

    throw new IdempotencyConflictError(
      "IDEMPOTENCY_IN_PROGRESS",
      "Idempotent request is already in progress; retry with the same key",
    );
  }
}
