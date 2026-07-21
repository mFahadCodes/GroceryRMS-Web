import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_REDACTED } from "../../../lib/security/audit-sanitizer";

const prismaRef = vi.hoisted(() => ({
  client: null as null | import("@prisma/client").PrismaClient,
}));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!prismaRef.client) {
      throw new Error("Disposable Prisma client is not initialized");
    }
    return prismaRef.client;
  },
}));

import { getAuditLogReport } from "../../../lib/services/report-service";
import {
  createManagerApprovalTestDatabase,
  resetManagerApprovalTables,
  seedManagerApprovalFixture,
} from "./manager-approval-test-database";

describe("audit read redaction", () => {
  const database = createManagerApprovalTestDatabase("sec05a-read");

  beforeEach(async () => {
    prismaRef.client = database.client;
    await resetManagerApprovalTables(database.client);
    await seedManagerApprovalFixture(database.client);
  });

  afterAll(async () => {
    await database.client.$disconnect();
    database.cleanup();
    prismaRef.client = null;
  });

  async function insertHistorical(action: string, newValues: string) {
    return database.client.auditLog.create({
      data: {
        userId: 2,
        action,
        tableName: "users",
        recordId: 2,
        newValues,
      },
    });
  }

  it("redacts historical unsafe password, PIN, token, cookie, and header metadata", async () => {
    const stored = await insertHistorical(
      "HISTORICAL_UNSAFE",
      JSON.stringify({
        password: "OldSecret1!",
        pin: "4826",
        token: "eyJhbGciOiJIUzI1NiJ9.aaa.bbb",
        cookie: "session=abc",
        authorization: "Bearer xyz",
        nested: { apiKey: "key-1", note: "visible" },
        orderId: 50,
      }),
    );

    const report = await getAuditLogReport(1, 20);
    const item = report.items.find((row) => row.id === stored.id);
    expect(item).toBeTruthy();
    expect(item!.newValues).toContain(AUDIT_REDACTED);
    expect(item!.newValues).toContain("visible");
    expect(item!.newValues).toContain("50");
    expect(item!.newValues).not.toContain("OldSecret1!");
    expect(item!.newValues).not.toContain("4826");
    expect(item!.newValues).not.toContain("Bearer");
    expect(item!.newValues).not.toContain("session=abc");
    expect(item!.newValues).not.toContain("key-1");
  });

  it("does not expose passwordHash or pin from the related user", async () => {
    await insertHistorical("USER_LINKED", JSON.stringify({ ok: true }));
    const report = await getAuditLogReport(1, 20);
    const serialized = JSON.stringify(report.items);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toMatch(/"pin":/);
    expect(serialized).toContain("requester");
  });

  it("preserves pagination and does not mutate stored rows", async () => {
    for (let i = 0; i < 3; i += 1) {
      await insertHistorical(
        `PAGE_${i}`,
        JSON.stringify({ password: `secret-${i}` }),
      );
    }
    const page1 = await getAuditLogReport(1, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBeGreaterThanOrEqual(3);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);

    const stored = await database.client.auditLog.findFirstOrThrow({
      where: { action: "PAGE_0" },
    });
    expect(stored.newValues).toContain("secret-0");

    const again = await getAuditLogReport(1, 20);
    const viewed = again.items.find((row) => row.action === "PAGE_0");
    expect(viewed!.newValues).toContain(AUDIT_REDACTED);
    expect(viewed!.newValues).not.toContain("secret-0");
  });

  it("does not return raw metadata alongside sanitized metadata", async () => {
    await insertHistorical(
      "NO_RAW_SIDE_CHANNEL",
      JSON.stringify({ password: "hidden", note: "ok" }),
    );
    const report = await getAuditLogReport(1, 5);
    const item = report.items.find(
      (row) => row.action === "NO_RAW_SIDE_CHANNEL",
    ) as Record<string, unknown>;
    expect(item.rawNewValues).toBeUndefined();
    expect(item.unsanitized).toBeUndefined();
    expect(Object.keys(item).sort()).toEqual(
      expect.arrayContaining([
        "id",
        "action",
        "newValues",
        "oldValues",
        "user",
      ]),
    );
  });
});
