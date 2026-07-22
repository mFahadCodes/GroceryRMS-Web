import { describe, expect, it } from "vitest";
import {
  AUDIT_EVENTS,
  AuditPolicyError,
  getAuditEventDefinition,
  isRegisteredAuditAction,
  type AuditMode,
} from "../../../lib/security/audit-policy";

const MODES: readonly AuditMode[] = [
  "TRANSACTION_REQUIRED",
  "BEST_EFFORT",
  "ACCESS_ACTIVITY",
] as const;

const SECURITY_EVENTS = [
  "PASSWORD_CHANGED",
  "PIN_CHANGED",
  "PIN_HASH_UPGRADED",
  "PIN_LOCKOUT_RESET",
  "PIN_VERIFICATION_SUCCEEDED",
  "PIN_VERIFICATION_FAILED",
  "PIN_VERIFICATION_THROTTLED",
  "FORCE_LOGOUT",
  "CREATE_USER",
  "UPDATE_USER",
  "DELETE_USER",
  "REPLACE_ROLE_PERMISSIONS",
  "MANAGER_APPROVAL_ISSUED",
  "MANAGER_APPROVAL_CONSUMED",
] as const;

describe("audit policy registry", () => {
  it("registers every event with exactly one mode", () => {
    for (const [action, definition] of Object.entries(AUDIT_EVENTS)) {
      expect(MODES, action).toContain(definition.mode);
      expect(
        MODES.filter((mode) => mode === definition.mode),
        action,
      ).toHaveLength(1);
    }
  });

  it("exposes a unique action name for every registry key", () => {
    const keys = Object.keys(AUDIT_EVENTS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("looks up registered definitions through getAuditEventDefinition", () => {
    expect(getAuditEventDefinition("CHECKOUT").mode).toBe(
      "TRANSACTION_REQUIRED",
    );
    expect(getAuditEventDefinition("CREATE_PRODUCT").mode).toBe("BEST_EFFORT");
    expect(getAuditEventDefinition("PRINT_RECEIPT").mode).toBe(
      "ACCESS_ACTIVITY",
    );
  });

  it("throws AuditPolicyError for unknown events", () => {
    expect(() => getAuditEventDefinition("NOT_A_REAL_AUDIT_EVENT")).toThrow(
      AuditPolicyError,
    );
    expect(() => getAuditEventDefinition("NOT_A_REAL_AUDIT_EVENT")).toThrow(
      /not registered/,
    );
  });

  it("reports registration status through isRegisteredAuditAction", () => {
    expect(isRegisteredAuditAction("PASSWORD_CHANGED")).toBe(true);
    expect(isRegisteredAuditAction("VOID_ORDER")).toBe(true);
    expect(isRegisteredAuditAction("UNKNOWN_ACTION")).toBe(false);
    expect(isRegisteredAuditAction("")).toBe(false);
  });

  it("declares TRANSACTION_REQUIRED mode for every required helper event", () => {
    for (const definition of Object.values(AUDIT_EVENTS)) {
      if (definition.mode === "TRANSACTION_REQUIRED") {
        expect(definition.mode).toBe("TRANSACTION_REQUIRED");
        expect(definition.entityTable).toEqual(expect.any(String));
        expect(definition.entityTable!.length).toBeGreaterThan(0);
      }
    }
  });

  it("includes BEST_EFFORT and ACCESS_ACTIVITY modes in the registry", () => {
    const modes = new Set(
      Object.values(AUDIT_EVENTS).map((definition) => definition.mode),
    );
    expect(modes.has("BEST_EFFORT")).toBe(true);
    expect(modes.has("ACCESS_ACTIVITY")).toBe(true);
    expect(modes.has("TRANSACTION_REQUIRED")).toBe(true);
  });

  it.each([
    "PASSWORD_CHANGED",
    "VOID_ORDER",
    "CHECKOUT",
    "REFUND_ORDER",
    "FORCE_LOGOUT",
    "REPLACE_ROLE_PERMISSIONS",
  ] as const)("marks critical event %s as TRANSACTION_REQUIRED", (action) => {
    expect(AUDIT_EVENTS[action].mode).toBe("TRANSACTION_REQUIRED");
  });

  it.each([
    ["UPDATE_ORDER_META", "BEST_EFFORT"],
    ["CREATE_PRODUCT", "BEST_EFFORT"],
  ] as const)("marks %s as %s", (action, mode) => {
    expect(AUDIT_EVENTS[action].mode).toBe(mode);
  });

  it.each([
    ["PRINT_RECEIPT", "ACCESS_ACTIVITY"],
    ["DB_BACKUP", "ACCESS_ACTIVITY"],
    ["OPEN_DRAWER", "ACCESS_ACTIVITY"],
  ] as const)("marks %s as %s", (action, mode) => {
    expect(AUDIT_EVENTS[action].mode).toBe(mode);
  });

  it("keeps a non-null entity table for security events", () => {
    for (const action of SECURITY_EVENTS) {
      expect(AUDIT_EVENTS[action].entityTable, action).not.toBeNull();
      expect(AUDIT_EVENTS[action].entityTable!.length, action).toBeGreaterThan(
        0,
      );
    }
  });

  it("keeps financial mutation entity tables on orders", () => {
    for (const action of [
      "VOID_ORDER",
      "APPLY_ORDER_DISCOUNT",
      "CHECKOUT",
      "PARTIAL_PAYMENT",
      "REFUND_ORDER",
      "RETURN",
    ] as const) {
      expect(AUDIT_EVENTS[action].entityTable).toBe("orders");
    }
  });

  it("registers historical SHIFT_CLOSE and CLOSE_SHIFT as distinct TRANSACTION_REQUIRED events", () => {
    expect(AUDIT_EVENTS.SHIFT_CLOSE.mode).toBe("TRANSACTION_REQUIRED");
    expect(AUDIT_EVENTS.CLOSE_SHIFT.mode).toBe("TRANSACTION_REQUIRED");
    expect(AUDIT_EVENTS.SHIFT_CLOSE.entityTable).toBe("shifts");
    expect(AUDIT_EVENTS.CLOSE_SHIFT.entityTable).toBe("shifts");
  });
});
