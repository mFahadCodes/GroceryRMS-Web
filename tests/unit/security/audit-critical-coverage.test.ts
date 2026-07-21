import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_EVENTS } from "../../../lib/security/audit-policy";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

function expectRequiredAuditAction(source: string, action: string) {
  expect(source).toContain("writeRequiredAudit");
  expect(source).toMatch(
    new RegExp(
      `writeRequiredAudit\\([\\s\\S]*?action:\\s*"${action}"`,
    ),
  );
}

describe("audit critical path coverage", () => {
  it("password-service writes PASSWORD_CHANGED through writeRequiredAudit", () => {
    expectRequiredAuditAction(
      read("lib/services/password-service.ts"),
      "PASSWORD_CHANGED",
    );
  });

  it.each([
    "VOID_ORDER",
    "APPLY_ORDER_DISCOUNT",
    "CHECKOUT",
    "PARTIAL_PAYMENT",
    "REFUND_ORDER",
    "RETURN",
  ] as const)("order-service writes %s through writeRequiredAudit", (action) => {
    expectRequiredAuditAction(read("lib/services/order-service.ts"), action);
  });

  it.each([
    "CREATE_USER",
    "UPDATE_USER",
    "DELETE_USER",
    "REPLACE_ROLE_PERMISSIONS",
    "UPSERT_SETTING",
  ] as const)(
    "settings-service writes %s through writeRequiredAudit",
    (action) => {
      expectRequiredAuditAction(
        read("lib/services/settings-service.ts"),
        action,
      );
    },
  );

  it("session-service writes FORCE_LOGOUT through writeRequiredAudit", () => {
    expectRequiredAuditAction(
      read("lib/services/session-service.ts"),
      "FORCE_LOGOUT",
    );
  });

  it.each(["RECEIVE_PURCHASE_ORDER", "APPLY_STOCK_TAKE"] as const)(
    "inventory-service writes %s through writeRequiredAudit",
    (action) => {
      expectRequiredAuditAction(
        read("lib/services/inventory-service.ts"),
        action,
      );
    },
  );

  it.each(["MANAGER_APPROVAL_ISSUED", "MANAGER_APPROVAL_CONSUMED"] as const)(
    "manager-approval-service writes %s through writeRequiredAudit",
    (action) => {
      expectRequiredAuditAction(
        read("lib/services/manager-approval-service.ts"),
        action,
      );
    },
  );

  it("documents that shift close remains BEST_EFFORT (deferred from TRANSACTION_REQUIRED)", () => {
    // Deferred: SHIFT_CLOSE / CLOSE_SHIFT stay BEST_EFFORT in audit-policy.ts
    // until a dedicated transactional shift-close integrity package lands.
    const policy = read("lib/security/audit-policy.ts");
    expect(policy).toMatch(/SHIFT_CLOSE:\s*bestEffort\("shifts"\)/);
    expect(policy).toMatch(/CLOSE_SHIFT:\s*bestEffort\("shifts"\)/);
    expect(AUDIT_EVENTS.SHIFT_CLOSE.mode).toBe("BEST_EFFORT");
    expect(AUDIT_EVENTS.CLOSE_SHIFT.mode).toBe("BEST_EFFORT");
  });
});
