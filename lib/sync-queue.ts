import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function enqueueSync(
  input: {
    tableName: string;
    recordId: number;
    operation: string;
    payload?: unknown;
  },
  tx?: Prisma.TransactionClient,
) {
  const client = tx ?? prisma;
  return client.syncQueue.create({
    data: {
      tableName: input.tableName,
      recordId: input.recordId,
      operation: input.operation,
      payload:
        input.payload === undefined
          ? null
          : JSON.stringify(input.payload, (_key, value) =>
              typeof value === "bigint" ? value.toString() : value,
            ),
      status: "Pending",
      retries: 0,
    },
  });
}
