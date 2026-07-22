import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { managerApprovalMigrationPaths } from "./manager-approval-test-database";

const root = path.resolve(".tmp");
const upgradePath = path.join(root, "sec02b-upgrade.test.db");
const freshPath = path.join(root, "sec02b-fresh.test.db");
const repeatPath = path.join(root, "sec02b-repeat.test.db");
const cascadePath = path.join(root, "sec02b-cascade.test.db");
const files = [upgradePath, freshPath, repeatPath, cascadePath].flatMap(
  (file) => [file, `${file}-journal`, `${file}-shm`, `${file}-wal`],
);
const migrations = managerApprovalMigrationPaths.map((file) =>
  readFileSync(path.resolve(file), "utf8"),
);
const stamp = "2026-07-23T00:00:00.000Z";

function cleanup() {
  for (const file of files) rmSync(file, { force: true });
}

function tableNames(db: Database.Database) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => (row as { name: string }).name);
}

function columnNames(db: Database.Database, table: string) {
  return db
    .prepare(`PRAGMA table_info('${table}')`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function foreignKeys(db: Database.Database, table: string) {
  return db.prepare(`PRAGMA foreign_key_list('${table}')`).all() as Array<{
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;
}

function seedCascadeFixture(db: Database.Database) {
  db.pragma("foreign_keys = ON");
  db.prepare(
    "INSERT INTO roles (id, updated_at, name) VALUES (1, ?, 'Role')",
  ).run(stamp);
  db.prepare(
    "INSERT INTO users (id, updated_at, username, full_name, password_hash, role_id) VALUES (2, ?, 'req', 'Requester', 'hash', 1)",
  ).run(stamp);
  db.prepare(
    "INSERT INTO users (id, updated_at, username, full_name, password_hash, role_id) VALUES (7, ?, 'mgr', 'Manager', 'hash', 1)",
  ).run(stamp);
  db.prepare(
    "INSERT INTO terminals (id, updated_at, name) VALUES (3, ?, 'Front')",
  ).run(stamp);
  db.prepare(
    "INSERT INTO user_sessions (id, updated_at, session_id, user_id, terminal_id, auth_version, expires_at) VALUES (11, ?, 'cascade_session_abcdefghijklmn', 2, 3, 1, ?)",
  ).run(stamp, "2026-07-24T00:00:00.000Z");
  db.prepare(
    "INSERT INTO user_sessions (id, updated_at, session_id, user_id, terminal_id, auth_version, expires_at) VALUES (12, ?, 'cascade_manager_session_abcdef', 7, 3, 1, ?)",
  ).run(stamp, "2026-07-24T00:00:00.000Z");
  db.prepare(
    "INSERT INTO orders (id, updated_at, order_number, order_type, status, cashier_id, terminal_id) VALUES (50, ?, 'ORD-50', 'WalkIn', 'Open', 2, 3)",
  ).run(stamp);
  db.prepare(
    `INSERT INTO manager_approval_grants (
      id, token_hash, requester_user_id, requester_session_id, requester_auth_version,
      approver_user_id, approver_auth_version, action, resource_type, resource_id,
      required_permission, required_access_level, terminal_id, expires_at, created_at
    ) VALUES (1, 'digest-a', 2, 11, 1, 7, 1, 'order.discount', 'order', 50, 'Apply discounts', 4, 3, ?, ?)`,
  ).run("2026-07-23T12:02:00.000Z", stamp);
}

describe("SEC-02B manager approval grants migration", () => {
  let upgrade: Database.Database | undefined;
  let fresh: Database.Database | undefined;
  let tablesBefore: string[];
  let productColumnsBefore: string[];
  let orderItemColumnsBefore: string[];

  beforeAll(() => {
    cleanup();
    mkdirSync(root, { recursive: true });

    upgrade = new Database(upgradePath);
    for (const migration of migrations.slice(0, -1)) upgrade.exec(migration);
    tablesBefore = tableNames(upgrade);
    productColumnsBefore = columnNames(upgrade, "products");
    orderItemColumnsBefore = columnNames(upgrade, "order_items");
    upgrade
      .prepare(
        "INSERT INTO roles (id, updated_at, name) VALUES (1, ?, 'Existing Role')",
      )
      .run(stamp);
    upgrade
      .prepare(
        "INSERT INTO users (id, updated_at, username, full_name, password_hash, role_id) VALUES (7, ?, 'existing', 'Existing', 'password-hash', 1)",
      )
      .run(stamp);
    upgrade.exec(migrations.at(-1)!);

    fresh = new Database(freshPath);
    for (const migration of migrations) fresh.exec(migration);
  });

  afterAll(() => {
    upgrade?.close();
    fresh?.close();
    upgrade = undefined;
    fresh = undefined;
    cleanup();
  });

  it("deploys the full migration chain to a fresh database", () => {
    expect(tableNames(fresh!)).toContain("manager_approval_grants");
  });

  it("upgrades from the pre-SEC-02B migration head", () => {
    expect(
      upgrade!.prepare("SELECT COUNT(*) count FROM users").get(),
    ).toEqual({ count: 1 });
    expect(tableNames(upgrade!)).toContain("manager_approval_grants");
  });

  it("keeps the table set unchanged when applying the latest additive OrderItem migration", () => {
    expect(tableNames(upgrade!)).toEqual(tablesBefore);
    expect(tablesBefore).toContain("idempotency_records");
  });

  it("adds returned_quantity and source_order_item_id on the latest upgrade step", () => {
    expect(orderItemColumnsBefore).not.toContain("returned_quantity");
    expect(orderItemColumnsBefore).not.toContain("source_order_item_id");
    const after = columnNames(upgrade!, "order_items");
    expect(after).toEqual(
      expect.arrayContaining(["returned_quantity", "source_order_item_id"]),
    );
  });

  it("does not change unrelated product columns", () => {
    expect(columnNames(upgrade!, "products")).toEqual(productColumnsBefore);
  });

  it("creates the unique token hash and supporting indexes", () => {
    const indexes = upgrade!
      .prepare("PRAGMA index_list('manager_approval_grants')")
      .all() as Array<{ name: string; unique: number }>;
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "manager_approval_grants_token_hash_key",
          unique: 1,
        }),
        expect.objectContaining({
          name: "manager_approval_grants_requester_session_id_idx",
        }),
        expect.objectContaining({
          name: "manager_approval_grants_approver_user_id_idx",
        }),
        expect.objectContaining({
          name: "manager_approval_grants_expires_at_idx",
        }),
        expect.objectContaining({
          name: "manager_approval_grants_resource_type_resource_id_action_idx",
        }),
      ]),
    );
  });

  it("declares explicit cascade foreign keys for every grant relation", () => {
    const keys = foreignKeys(upgrade!, "manager_approval_grants");
    expect(keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "users",
          from: "requester_user_id",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          table: "users",
          from: "approver_user_id",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          table: "user_sessions",
          from: "requester_session_id",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          table: "orders",
          from: "resource_id",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          table: "terminals",
          from: "terminal_id",
          on_delete: "CASCADE",
        }),
      ]),
    );
    expect(keys.every((key) => key.on_delete === "CASCADE")).toBe(true);
  });

  it("repeats cleanly from another absent database", () => {
    const repeat = new Database(repeatPath);
    try {
      for (const migration of migrations) repeat.exec(migration);
      expect(tableNames(repeat)).toEqual(tableNames(fresh!));
    } finally {
      repeat.close();
      rmSync(repeatPath, { force: true });
    }
  });

  it("cascades grant deletion when the requester user is removed", () => {
    const db = new Database(cascadePath);
    try {
      for (const migration of migrations) db.exec(migration);
      seedCascadeFixture(db);
      // Keep the grant row while clearing non-cascade blockers on users.
      db.prepare(
        "UPDATE manager_approval_grants SET requester_session_id = 12 WHERE id = 1",
      ).run();
      db.prepare("DELETE FROM user_sessions WHERE id = 11").run();
      db.prepare("UPDATE orders SET cashier_id = NULL WHERE id = 50").run();
      db.prepare("DELETE FROM users WHERE id = 2").run();
      expect(
        db.prepare("SELECT COUNT(*) count FROM manager_approval_grants").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
      for (const file of [
        cascadePath,
        `${cascadePath}-journal`,
        `${cascadePath}-shm`,
        `${cascadePath}-wal`,
      ]) {
        rmSync(file, { force: true });
      }
    }
  });

  it("cascades grant deletion when the requester session is removed", () => {
    const db = new Database(cascadePath);
    try {
      for (const migration of migrations) db.exec(migration);
      seedCascadeFixture(db);
      db.prepare("DELETE FROM user_sessions WHERE id = 11").run();
      expect(
        db.prepare("SELECT COUNT(*) count FROM manager_approval_grants").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
      for (const file of [
        cascadePath,
        `${cascadePath}-journal`,
        `${cascadePath}-shm`,
        `${cascadePath}-wal`,
      ]) {
        rmSync(file, { force: true });
      }
    }
  });

  it("cascades grant deletion when the order resource is removed", () => {
    const db = new Database(cascadePath);
    try {
      for (const migration of migrations) db.exec(migration);
      seedCascadeFixture(db);
      db.prepare("DELETE FROM orders WHERE id = 50").run();
      expect(
        db.prepare("SELECT COUNT(*) count FROM manager_approval_grants").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
      for (const file of [
        cascadePath,
        `${cascadePath}-journal`,
        `${cascadePath}-shm`,
        `${cascadePath}-wal`,
      ]) {
        rmSync(file, { force: true });
      }
    }
  });

  it("cascades grant deletion when the terminal is removed", () => {
    const db = new Database(cascadePath);
    try {
      for (const migration of migrations) db.exec(migration);
      seedCascadeFixture(db);
      // Clear NoAction blockers while leaving the grant terminal FK intact.
      db.prepare("UPDATE orders SET terminal_id = NULL WHERE id = 50").run();
      db.prepare("DELETE FROM user_sessions WHERE id = 12").run();
      db.prepare("UPDATE user_sessions SET terminal_id = NULL WHERE id = 11").run();
      db.prepare("DELETE FROM terminals WHERE id = 3").run();
      expect(
        db.prepare("SELECT COUNT(*) count FROM manager_approval_grants").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
      for (const file of [
        cascadePath,
        `${cascadePath}-journal`,
        `${cascadePath}-shm`,
        `${cascadePath}-wal`,
      ]) {
        rmSync(file, { force: true });
      }
    }
  });

  it("cascades grant deletion when the approver user is removed", () => {
    const db = new Database(cascadePath);
    try {
      for (const migration of migrations) db.exec(migration);
      seedCascadeFixture(db);
      // Clear the approver session NoAction blocker; grant still references approver user 7.
      db.prepare("DELETE FROM user_sessions WHERE id = 12").run();
      db.prepare("DELETE FROM users WHERE id = 7").run();
      expect(
        db.prepare("SELECT COUNT(*) count FROM manager_approval_grants").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
      for (const file of [
        cascadePath,
        `${cascadePath}-journal`,
        `${cascadePath}-shm`,
        `${cascadePath}-wal`,
      ]) {
        rmSync(file, { force: true });
      }
    }
  });
});
