import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pinMigrationPaths } from "./pin-test-database";

const root = path.resolve(".tmp");
const upgradePath = path.join(root, "sec02a-upgrade.test.db");
const freshPath = path.join(root, "sec02a-fresh.test.db");
const repeatPath = path.join(root, "sec02a-repeat.test.db");
const files = [upgradePath, freshPath, repeatPath].flatMap((file) => [
  file,
  `${file}-journal`,
  `${file}-shm`,
  `${file}-wal`,
]);
const migrations = pinMigrationPaths.map((file) =>
  readFileSync(path.resolve(file), "utf8"),
);

function cleanup() {
  for (const file of files) rmSync(file, { force: true });
}

describe("SEC-02A PIN security migration", () => {
  let upgrade: Database.Database | undefined;
  let fresh: Database.Database | undefined;
  let tablesBefore: string[];
  let productColumnsBefore: string[];

  beforeAll(() => {
    cleanup();
    mkdirSync(root, { recursive: true });
    upgrade = new Database(upgradePath);
    for (const migration of migrations.slice(0, -1)) upgrade.exec(migration);
    tablesBefore = tableNames(upgrade);
    productColumnsBefore = columnNames(upgrade, "products");
    upgrade.prepare("INSERT INTO roles (id, updated_at, name) VALUES (1, ?, 'Existing Role')").run("2026-07-22T00:00:00.000Z");
    upgrade.prepare("INSERT INTO users (id, updated_at, username, full_name, password_hash, pin, role_id) VALUES (7, ?, 'existing', 'Existing', 'password-hash', 'legacy-pin-hash', 1)").run("2026-07-22T00:00:00.000Z");
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
    expect(tableNames(fresh!)).toContain("pin_throttle_states");
  });
  it("upgrades from the pre-SEC-02A migration head", () => {
    expect(upgrade!.prepare("SELECT COUNT(*) count FROM users").get()).toEqual({ count: 1 });
  });
  it("preserves the existing PIN hash exactly", () => {
    expect(upgrade!.prepare("SELECT pin FROM users WHERE id=7").get()).toEqual({ pin: "legacy-pin-hash" });
  });
  it("assigns zero/null user throttle defaults", () => {
    expect(upgrade!.prepare("SELECT pin_failed_attempts, pin_last_failed_at, pin_locked_until FROM users WHERE id=7").get()).toEqual({ pin_failed_attempts: 0, pin_last_failed_at: null, pin_locked_until: null });
  });
  it("starts with an empty aggregate throttle table", () => {
    expect(upgrade!.prepare("SELECT COUNT(*) count FROM pin_throttle_states").get()).toEqual({ count: 0 });
  });
  it("adds only the throttle table to the existing table set", () => {
    expect(tableNames(upgrade!)).toEqual([...tablesBefore, "pin_throttle_states"].sort());
  });
  it("does not change unrelated product columns", () => {
    expect(columnNames(upgrade!, "products")).toEqual(productColumnsBefore);
  });
  it("creates the composite unique and expiry indexes", () => {
    const indexes = upgrade!.prepare("PRAGMA index_list('pin_throttle_states')").all() as Array<{ name: string; unique: number }>;
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "pin_throttle_states_scope_key_hash_key", unique: 1 }),
      expect.objectContaining({ name: "pin_throttle_states_expires_at_idx" }),
    ]));
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
});

function tableNames(db: Database.Database) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => (row as { name: string }).name);
}

function columnNames(db: Database.Database, table: string) {
  return db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => (row as { name: string }).name);
}
