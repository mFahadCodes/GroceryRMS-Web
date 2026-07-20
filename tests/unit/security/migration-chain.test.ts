import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databasePath = path.resolve(".tmp/sec03a-migration-chain.test.db");
const sidecars = [databasePath, `${databasePath}-journal`, `${databasePath}-shm`, `${databasePath}-wal`];
const baselineSql = readFileSync(
  path.resolve("prisma/migrations/20260720_000000_baseline/migration.sql"),
  "utf8",
);
const securitySql = readFileSync(
  path.resolve(
    "prisma/migrations/20260720_010000_authoritative_sessions/migration.sql",
  ),
  "utf8",
);

type Column = { name: string; notnull: number; dflt_value: string | null };

function removeDatabase() {
  for (const file of sidecars) rmSync(file, { force: true });
}

describe("SEC-03A disposable migration chain", () => {
  let db: Database.Database | undefined;
  let baselineTables: string[];

  function getDatabase(): Database.Database {
    if (!db) throw new Error("Disposable migration database is not initialized");
    return db;
  }

  beforeAll(() => {
    removeDatabase();
    mkdirSync(path.dirname(databasePath), { recursive: true });
    db = new Database(databasePath);
    db.exec(baselineSql);
    baselineTables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    db.prepare(
      "INSERT INTO roles (id, updated_at, name) VALUES (?, ?, ?)",
    ).run(1, "2026-07-20T08:00:00.000Z", "Legacy Role");
    db.prepare(
      "INSERT INTO users (id, updated_at, username, full_name, password_hash, role_id) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      7,
      "2026-07-20T08:00:00.000Z",
      "legacy-user",
      "Legacy User",
      "test-only-hash",
      1,
    );
    db.prepare(
      "INSERT INTO user_sessions (id, updated_at, user_id, ip_address) VALUES (?, ?, ?, ?)",
    ).run(11, "2026-07-20T08:00:00.000Z", 7, "127.0.0.1");
    db.exec(securitySql);
  });

  afterAll(() => {
    if (db) {
      db.close();
      db = undefined;
    }
    removeDatabase();
  });

  it("fresh baseline SQL creates the complete application schema", () => {
    expect(baselineTables).toContain("users");
    expect(baselineTables).toContain("user_sessions");
    expect(baselineTables.length).toBeGreaterThan(30);
  });

  it("the security migration adds only the required authentication columns", () => {
    const database = getDatabase();
    const userColumns = database
      .prepare("PRAGMA table_info('users')")
      .all() as Column[];
    const sessionColumns = database
      .prepare("PRAGMA table_info('user_sessions')")
      .all() as Column[];
    expect(userColumns.find((column) => column.name === "auth_version")).toMatchObject({
      notnull: 1,
      dflt_value: "1",
    });
    expect(sessionColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "session_id",
        "auth_version",
        "expires_at",
        "revoked_reason",
      ]),
    );
  });

  it("the baseline upgrade preserves existing users and sessions", () => {
    const database = getDatabase();
    expect(
      database
        .prepare("SELECT id, username, auth_version FROM users WHERE id = 7")
        .get(),
    ).toEqual({ id: 7, username: "legacy-user", auth_version: 1 });
    expect(
      database
        .prepare("SELECT id, user_id FROM user_sessions WHERE id = 11")
        .get(),
    ).toEqual({ id: 11, user_id: 7 });
  });

  it("legacy sessions fail closed through nullable new authority fields", () => {
    expect(
      getDatabase()
        .prepare(
          "SELECT session_id, auth_version, expires_at, revoked_reason FROM user_sessions WHERE id = 11",
        )
        .get(),
    ).toEqual({
      session_id: null,
      auth_version: null,
      expires_at: null,
      revoked_reason: null,
    });
  });

  it("the security upgrade leaves the domain table set unchanged", () => {
    const upgradedTables = getDatabase()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(upgradedTables).toEqual(baselineTables);
  });

  it("the opaque session identifier is unique", () => {
    const indexes = getDatabase()
      .prepare("PRAGMA index_list('user_sessions')")
      .all() as Array<{
        name: string;
        unique: number;
      }>;
    expect(indexes).toContainEqual(
      expect.objectContaining({
        name: "user_sessions_session_id_key",
        unique: 1,
      }),
    );
  });
});
