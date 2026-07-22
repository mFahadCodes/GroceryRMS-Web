import { describe, expect, it } from "vitest";
import { buildShiftCloseAuditMetadata } from "../../../lib/security/audit-metadata";
import { AUDIT_EVENTS } from "../../../lib/security/audit-policy";

describe("shift close audit policy", () => {
  it("marks SHIFT_CLOSE as TRANSACTION_REQUIRED", () => {
    expect(AUDIT_EVENTS.SHIFT_CLOSE.mode).toBe("TRANSACTION_REQUIRED");
  });

  it("marks CLOSE_SHIFT as TRANSACTION_REQUIRED", () => {
    expect(AUDIT_EVENTS.CLOSE_SHIFT.mode).toBe("TRANSACTION_REQUIRED");
  });

  it("binds SHIFT_CLOSE to the shifts entity table", () => {
    expect(AUDIT_EVENTS.SHIFT_CLOSE.entityTable).toBe("shifts");
  });

  it("binds CLOSE_SHIFT to the shifts entity table", () => {
    expect(AUDIT_EVENTS.CLOSE_SHIFT.entityTable).toBe("shifts");
  });

  it("requires an actor for SHIFT_CLOSE", () => {
    expect(AUDIT_EVENTS.SHIFT_CLOSE.requiresActor).toBe(true);
  });

  it("requires an actor for CLOSE_SHIFT", () => {
    expect(AUDIT_EVENTS.CLOSE_SHIFT.requiresActor).toBe(true);
  });

  it("requires an entity id for SHIFT_CLOSE", () => {
    expect(AUDIT_EVENTS.SHIFT_CLOSE.requiresEntityId).toBe(true);
  });

  it("requires an entity id for CLOSE_SHIFT", () => {
    expect(AUDIT_EVENTS.CLOSE_SHIFT.requiresEntityId).toBe(true);
  });

  it("keeps OPEN_SHIFT as BEST_EFFORT", () => {
    expect(AUDIT_EVENTS.OPEN_SHIFT.mode).toBe("BEST_EFFORT");
    expect(AUDIT_EVENTS.OPEN_SHIFT.entityTable).toBe("shifts");
    expect(AUDIT_EVENTS.OPEN_SHIFT.requiresActor).toBe(false);
    expect(AUDIT_EVENTS.OPEN_SHIFT.requiresEntityId).toBe(false);
  });

  it("buildShiftCloseAuditMetadata never includes raw notes text", () => {
    const notes = "drawer short because of spilled coffee and PIN 4826";
    const metadata = buildShiftCloseAuditMetadata({
      closingBalance: 12_500n,
      expectedBalance: 12_000n,
      discrepancy: 500n,
      terminalId: 1,
      notes,
    });
    expect(metadata).toMatchObject({
      reasonProvided: true,
      reasonLength: notes.length,
      closingBalance: "12500",
      expectedBalance: "12000",
      discrepancy: "500",
      terminalId: 1,
    });
    expect(Object.keys(metadata)).not.toContain("notes");
    expect(Object.keys(metadata)).not.toContain("reason");
    expect(JSON.stringify(metadata)).not.toContain("spilled");
    expect(JSON.stringify(metadata)).not.toContain("4826");
    expect(JSON.stringify(metadata)).not.toContain(notes);
  });

  it("summarizes empty or whitespace notes without claiming a reason", () => {
    for (const notes of [null, undefined, "", "   ", "\t\n"]) {
      const metadata = buildShiftCloseAuditMetadata({
        closingBalance: 0n,
        expectedBalance: 0n,
        discrepancy: 0n,
        terminalId: null,
        notes,
      });
      expect(metadata.reasonProvided).toBe(false);
      expect(metadata.reasonLength).toBe(0);
      expect(metadata.terminalId).toBeNull();
    }
  });

  it("serializes bigint totals as decimal strings", () => {
    const metadata = buildShiftCloseAuditMetadata({
      closingBalance: 9_007_199_254_740_991n,
      expectedBalance: 9_007_199_254_740_990n,
      discrepancy: 1n,
      terminalId: 3,
      notes: null,
    });
    expect(metadata.closingBalance).toBe("9007199254740991");
    expect(metadata.expectedBalance).toBe("9007199254740990");
    expect(metadata.discrepancy).toBe("1");
  });

  it("records negative discrepancy without free-text notes", () => {
    const metadata = buildShiftCloseAuditMetadata({
      closingBalance: 100n,
      expectedBalance: 250n,
      discrepancy: -150n,
      terminalId: 2,
      notes: "short drawer explanation must not appear",
    });
    expect(metadata.discrepancy).toBe("-150");
    expect(JSON.stringify(metadata)).not.toContain("short drawer");
  });
});
