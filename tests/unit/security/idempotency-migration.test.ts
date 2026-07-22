import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { managerApprovalMigrationPaths } from "./manager-approval-test-database";

function openDisposableDatabase(name: string) {
  const databasePath = path.resolve(`.tmp/${name}.test.db`);
  const files = [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ];
  for (const file of files) rmSync(file, { force: true });
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, databasePath, cleanup: () => {
    for (const file of files) rmSync(file, { force: true });
  } };
}

function applyMigrations(sqlite: Database.Database, migrationPaths: readonly string[]) {
  for (const migration of migrationPaths) {
    sqlite.exec(readFileSync(path.resolve(migration), "utf8"));
  }
}

const idempotencyMigrationPath =
  "prisma/migrations/20260724_000000_add_financial_idempotency_records/migration.sql";
const priorMigrationPaths = managerApprovalMigrationPaths.filter(
  (migrationPath) => migrationPath !== idempotencyMigrationPath,
);

describe("idempotency migration (applied from zero)", () => {
  let db: ReturnType<typeof openDisposableDatabase> | null = null;

  afterEach(() => {
    db?.sqlite.close();
    db?.cleanup();
    db = null;
  });

  it("applies the full migration set from an empty database without error", () => {
    db = openDisposableDatabase("p0a-migration-zero");
    expect(() => applyMigrations(db!.sqlite, managerApprovalMigrationPaths)).not.toThrow();
  });

  it("creates the idempotency_records table", () => {
    db = openDisposableDatabase("p0a-migration-table");
    applyMigrations(db.sqlite, managerApprovalMigrationPaths);
    const row = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_records'")
      .get();
    expect(row).toBeTruthy();
  });

  it("has every column P0-A depends on, with no raw-key column", () => {
    db = openDisposableDatabase("p0a-migration-columns");
    applyMigrations(db.sqlite, managerApprovalMigrationPaths);
    const columns = db.sqlite
      .prepare("PRAGMA table_info(idempotency_records)")
      .all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "created_at",
        "updated_at",
        "scope_hash",
        "key_digest",
        "request_hash",
        "operation",
        "resource_type",
        "resource_id",
        "actor_user_id",
        "terminal_scope",
        "state",
        "response_status",
        "response_body",
        "completed_at",
        "expires_at",
      ]),
    );
    expect(names).not.toContain("raw_key");
    expect(names).not.toContain("idempotency_key");
  });

  it("has a unique index on scope_hash", () => {
    db = openDisposableDatabase("p0a-migration-unique-index");
    applyMigrations(db.sqlite, managerApprovalMigrationPaths);
    const indexes = db.sqlite
      .prepare("PRAGMA index_list(idempotency_records)")
      .all() as Array<{ name: string; unique: number }>;
    const scopeIndex = indexes.find((i) => i.name === "idempotency_records_scope_hash_key");
    expect(scopeIndex).toBeTruthy();
    expect(scopeIndex!.unique).toBe(1);

    const indexInfo = db.sqlite
      .prepare(`PRAGMA index_info(${scopeIndex!.name})`)
      .all() as Array<{ name: string }>;
    expect(indexInfo.map((c) => c.name)).toEqual(["scope_hash"]);
  });

  it("has a non-unique index on expires_at", () => {
    db = openDisposableDatabase("p0a-migration-expires-index");
    applyMigrations(db.sqlite, managerApprovalMigrationPaths);
    const indexes = db.sqlite
      .prepare("PRAGMA index_list(idempotency_records)")
      .all() as Array<{ name: string; unique: number }>;
    const expiresIndex = indexes.find((i) => i.name === "idempotency_records_expires_at_idx");
    expect(expiresIndex).toBeTruthy();
    expect(expiresIndex!.unique).toBe(0);

    const indexInfo = db.sqlite
      .prepare(`PRAGMA index_info(${expiresIndex!.name})`)
      .all() as Array<{ name: string }>;
    expect(indexInfo.map((c) => c.name)).toEqual(["expires_at"]);
  });

  it("declares no foreign keys on idempotency_records (scalar identifiers only)", () => {
    db = openDisposableDatabase("p0a-migration-no-fk");
    applyMigrations(db.sqlite, managerApprovalMigrationPaths);
    const fks = db.sqlite.prepare("PRAGMA foreign_key_list(idempotency_records)").all();
    expect(fks).toEqual([]);
  });

  it("enforces the unique scope_hash constraint at the SQLite level", () => {
    db = openDisposableDatabase("p0a-migration-unique-enforced");
    applyMigrations(db.sqlite, managerApprovalMigrationPaths);
    db.sqlite.exec(`
      INSERT INTO idempotency_records
        (updated_at, scope_hash, key_digest, request_hash, operation, resource_type, resource_id, actor_user_id, terminal_scope, state)
      VALUES
        (CURRENT_TIMESTAMP, 'scope-a', 'digest-a', 'request-a', 'order.checkout', 'orders', 1, 1, 't:1', 'IN_PROGRESS');
    `);
    expect(() =>
      db!.sqlite.exec(`
        INSERT INTO idempotency_records
          (updated_at, scope_hash, key_digest, request_hash, operation, resource_type, resource_id, actor_user_id, terminal_scope, state)
        VALUES
          (CURRENT_TIMESTAMP, 'scope-a', 'digest-b', 'request-b', 'order.checkout', 'orders', 2, 2, 't:2', 'IN_PROGRESS');
      `),
    ).toThrow(/unique/i);
  });

  it("still allows a normal end-to-end insert/select once migrated, and the users table remains queryable", () => {
    db = openDisposableDatabase("p0a-migration-e2e");
    applyMigrations(db.sqlite, managerApprovalMigrationPaths);
    db.sqlite.exec(`
      INSERT INTO roles (id, created_at, updated_at, is_active, name) VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'Cashier');
      INSERT INTO users (id, created_at, updated_at, is_active, username, full_name, password_hash, role_id, auth_version, must_change_password, pin_failed_attempts)
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'cashier', 'Cashier', 'hash', 1, 1, 0, 0);
    `);
    const user = db.sqlite.prepare("SELECT username FROM users WHERE id = 1").get() as {
      username: string;
    };
    expect(user.username).toBe("cashier");
  });
});

describe("idempotency migration (upgrade path onto an existing database)", () => {
  let db: ReturnType<typeof openDisposableDatabase> | null = null;

  afterEach(() => {
    db?.sqlite.close();
    db?.cleanup();
    db = null;
  });

  it("does not create idempotency_records before the P0-A migration is applied", () => {
    db = openDisposableDatabase("p0a-migration-pre-upgrade");
    applyMigrations(db.sqlite, priorMigrationPaths);
    const row = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_records'")
      .get();
    expect(row).toBeUndefined();
  });

  it("applies cleanly when the 20260724 migration is run alone on top of the manager-approval baseline", () => {
    db = openDisposableDatabase("p0a-migration-upgrade");
    applyMigrations(db.sqlite, priorMigrationPaths);
    expect(() =>
      db!.sqlite.exec(readFileSync(path.resolve(idempotencyMigrationPath), "utf8")),
    ).not.toThrow();

    const row = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_records'")
      .get();
    expect(row).toBeTruthy();
  });

  it("keeps the existing users table queryable and untouched after the upgrade migration", () => {
    db = openDisposableDatabase("p0a-migration-upgrade-users");
    applyMigrations(db.sqlite, priorMigrationPaths);
    db.sqlite.exec(`
      INSERT INTO roles (id, created_at, updated_at, is_active, name) VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'Cashier');
      INSERT INTO users (id, created_at, updated_at, is_active, username, full_name, password_hash, role_id, auth_version, must_change_password, pin_failed_attempts)
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'pre-upgrade-user', 'Pre Upgrade', 'hash', 1, 1, 0, 0);
    `);

    db.sqlite.exec(readFileSync(path.resolve(idempotencyMigrationPath), "utf8"));

    const user = db.sqlite
      .prepare("SELECT username FROM users WHERE id = 1")
      .get() as { username: string };
    expect(user.username).toBe("pre-upgrade-user");
  });

  it("produces a byte-identical schema to a from-zero migration for idempotency_records", () => {
    const fromZero = openDisposableDatabase("p0a-migration-schema-zero");
    applyMigrations(fromZero.sqlite, managerApprovalMigrationPaths);
    const zeroSchema = fromZero.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='idempotency_records'")
      .get() as { sql: string };
    fromZero.sqlite.close();
    fromZero.cleanup();

    db = openDisposableDatabase("p0a-migration-schema-upgrade");
    applyMigrations(db.sqlite, priorMigrationPaths);
    db.sqlite.exec(readFileSync(path.resolve(idempotencyMigrationPath), "utf8"));
    const upgradeSchema = db.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='idempotency_records'")
      .get() as { sql: string };

    expect(upgradeSchema.sql).toBe(zeroSchema.sql);
  });
});
