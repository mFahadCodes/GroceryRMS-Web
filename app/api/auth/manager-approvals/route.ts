import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { requireSession } from "@/lib/api/rbac";
import { resolveClientIp } from "@/lib/client-ip";
import {
  cleanupManagerApprovalGrants,
  issueManagerApprovalGrant,
  ManagerApprovalServiceError,
} from "@/lib/services/manager-approval-service";
import { managerApprovalIssuanceSchema } from "@/lib/validators/manager-approval.validators";

const MAX_APPROVAL_REQUEST_BYTES = 4 * 1024;

export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (!auth.session.authoritative) {
    return fail(
      "Manager approval is unavailable",
      "MANAGER_APPROVAL_UNAVAILABLE",
      503,
    );
  }

  const body = await readBoundedJson(request);
  const parsed = managerApprovalIssuanceSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request body", "VALIDATION_ERROR", 400);
  }

  try {
    const issued = await issueManagerApprovalGrant({
      requester: {
        userId: auth.session.user.id,
        sessionId: auth.session.authoritative.sessionId,
        authVersion: auth.session.authoritative.authVersion,
        terminalId: auth.session.authoritative.terminalId,
        permissions: auth.session.user.permissions,
      },
      managerUserId: parsed.data.managerUserId,
      managerPin: parsed.data.managerPin,
      action: parsed.data.action,
      resourceType: parsed.data.resourceType,
      resourceId: parsed.data.resourceId,
      clientIp: resolveClientIp(request),
    });

    await cleanupManagerApprovalGrants();
    return ok(
      {
        approvalToken: issued.approvalToken,
        action: issued.action,
        resourceType: issued.resourceType,
        resourceId: issued.resourceId,
        expiresAt: issued.expiresAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    if (error instanceof ManagerApprovalServiceError) {
      const response = fail(
        approvalErrorMessage(error.code),
        error.code,
        error.status,
      );
      if (
        error.code === "MANAGER_APPROVAL_THROTTLED" &&
        error.retryAfterSeconds
      ) {
        response.headers.set(
          "Retry-After",
          String(error.retryAfterSeconds),
        );
      }
      return response;
    }
    return fail(
      "Manager approval is unavailable",
      "MANAGER_APPROVAL_UNAVAILABLE",
      503,
    );
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_APPROVAL_REQUEST_BYTES
  ) {
    return null;
  }
  try {
    const text = await request.text();
    if (
      new TextEncoder().encode(text).byteLength >
      MAX_APPROVAL_REQUEST_BYTES
    ) {
      return null;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function approvalErrorMessage(code: ManagerApprovalServiceError["code"]) {
  if (code === "MANAGER_APPROVAL_THROTTLED") {
    return "Manager approval is temporarily unavailable";
  }
  if (code === "MANAGER_APPROVAL_UNAVAILABLE") {
    return "Manager approval is unavailable";
  }
  return "Manager approval failed";
}
