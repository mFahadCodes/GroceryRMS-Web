import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(".tmp");
const upgradePath = path.join(root, "sec01b-upgrade.test.db");
const freshPath = path.join(root, "sec01b-fresh.test.db");
const files = [upgradePath, freshPath].flatMap((file) => [file, `${file}-journal`, `${file}-shm`, `${file}-wal`]);
const migrationPaths = [
  "prisma/migrations/20260720_000000_baseline/migration.sql",
  "prisma/migrations/20260720_010000_authoritative_sessions/migration.sql",
  "prisma/migrations/20260721_000000_add_password_rotation_state/migration.sql",
];
const migrations = migrationPaths.map((file) => readFileSync(path.resolve(file), "utf8"));

function cleanup() {
  for (const file of files) rmSync(file, { force: true });
}

describe("password-rotation migration", () => {
  let upgrade: Database.Database | undefined;
  let fresh: Database.Database | undefined;
  let tablesBefore: string[];
  let productColumnsBefore: string[];

  beforeAll(() => {
    cleanup();
    mkdirSync(path.dirname(upgradePath), { recursive: true });
    upgrade = new Database(upgradePath);
    upgrade.exec(migrations[0]);
    upgrade.exec(migrations[1]);
    tablesBefore = upgrade.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => (row as { name: string }).name);
    productColumnsBefore = upgrade.prepare("PRAGMA table_info('products')").all().map((row) => (row as { name: string }).name);
    upgrade.prepare("INSERT INTO roles (id, updated_at, name) VALUES (1, ?, 'Existing Role')").run("2026-07-21T08:00:00.000Z");
    upgrade.prepare("INSERT INTO users (id, updated_at, username, full_name, password_hash, role_id) VALUES (7, ?, 'existing-user', 'Existing User', 'test-hash', 1)").run("2026-07-21T08:00:00.000Z");
    upgrade.exec(migrations[2]);

    fresh = new Database(freshPath);
    for (const migration of migrations) fresh.exec(migration);
  });

  afterAll(() => {
    if (upgrade) upgrade.close();
    if (fresh) fresh.close();
    upgrade = undefined;
    fresh = undefined;
    cleanup();
  });

  function db(value: Database.Database | undefined) {
    if (!value) throw new Error("Disposable migration database is not initialized");
    return value;
  }

  it("deploys the complete migration chain to a fresh database", () => {
    expect(db(fresh).prepare("PRAGMA table_info('users')").all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "must_change_password", dflt_value: "false" }),
      expect.objectContaining({ name: "password_changed_at" }),
    ]));
  });
  it("upgrades a database at the previous migration head", () => {
    expect(db(upgrade).prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 1 });
  });
  it("does not force existing users to rotate", () => {
    expect(db(upgrade).prepare("SELECT must_change_password, password_changed_at FROM users WHERE id=7").get()).toEqual({ must_change_password: 0, password_changed_at: null });
  });
  it("gives ordinary new users the safe default", () => {
    db(fresh).prepare("INSERT INTO roles (id, updated_at, name) VALUES (1, ?, 'Role')").run("2026-07-21T08:00:00.000Z");
    db(fresh).prepare("INSERT INTO users (updated_at, username, full_name, password_hash, role_id) VALUES (?, 'new-user', 'New User', 'test-hash', 1)").run("2026-07-21T08:00:00.000Z");
    expect(db(fresh).prepare("SELECT must_change_password, password_changed_at FROM users WHERE username='new-user'").get()).toEqual({ must_change_password: 0, password_changed_at: null });
  });
  it("preserves every existing application table", () => {
    const after = db(upgrade).prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => (row as { name: string }).name);
    expect(after).toEqual(tablesBefore);
  });
  it("does not change unrelated domain columns", () => {
    const after = db(upgrade).prepare("PRAGMA table_info('products')").all().map((row) => (row as { name: string }).name);
    expect(after).toEqual(productColumnsBefore);
  });
});
