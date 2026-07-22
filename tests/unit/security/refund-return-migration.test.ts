import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { managerApprovalMigrationPaths } from "./manager-approval-test-database";

describe("order item return quantity migration", () => {
  const databasePath = path.resolve(".tmp/p0c1-migration-upgrade.test.db");
  const files = [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ];

  afterAll(() => {
    for (const file of files) rmSync(file, { force: true });
  });

  it("fresh migration applies returned_quantity default 0 and source lineage column", () => {
    for (const file of files) rmSync(file, { force: true });
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const sqlite = new Database(databasePath);
    try {
      sqlite.pragma("foreign_keys = ON");
      for (const migration of managerApprovalMigrationPaths) {
        sqlite.exec(readFileSync(path.resolve(migration), "utf8"));
      }
      const columns = sqlite
        .prepare(`PRAGMA table_info('order_items')`)
        .all() as Array<{ name: string; dflt_value: string | null }>;
      const returned = columns.find((c) => c.name === "returned_quantity");
      const source = columns.find((c) => c.name === "source_order_item_id");
      expect(returned).toBeTruthy();
      expect(returned?.dflt_value).toBe("0");
      expect(source).toBeTruthy();
    } finally {
      sqlite.close();
    }
  });

  it("upgrade path sets returned_quantity=0 for existing ordinary rows", () => {
    for (const file of files) rmSync(file, { force: true });
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const sqlite = new Database(databasePath);
    try {
      sqlite.pragma("foreign_keys = ON");
      const withoutLatest = managerApprovalMigrationPaths.slice(0, -1);
      for (const migration of withoutLatest) {
        sqlite.exec(readFileSync(path.resolve(migration), "utf8"));
      }

      // Minimal rows against the pre-P0-C1 schema (no returned_quantity yet).
      sqlite.exec(`
        INSERT INTO "roles" ("id", "created_at", "updated_at", "is_active", "name")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'Cashier');
        INSERT INTO "users" ("id", "created_at", "updated_at", "is_active", "username", "full_name", "password_hash", "role_id")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'u', 'U', 'hash', 1);
        INSERT INTO "product_categories" ("id", "created_at", "updated_at", "is_active", "name")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'G');
        INSERT INTO "products" ("id", "created_at", "updated_at", "is_active", "name", "base_price", "cost_price", "category_id", "current_stock", "reorder_level")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'P', 100, 50, 1, 10, 0);
        INSERT INTO "orders" ("id", "created_at", "updated_at", "is_active", "order_number", "order_type", "status", "sub_total", "grand_total")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'ORD-1', 'WalkIn', 'Closed', 100, 100);
        INSERT INTO "order_items" ("id", "created_at", "updated_at", "is_active", "order_id", "product_id", "quantity", "unit_price", "line_total", "status")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, 1, 2, 50, 100, 'Closed');
      `);

      const latest = managerApprovalMigrationPaths.at(-1)!;
      sqlite.exec(readFileSync(path.resolve(latest), "utf8"));

      const row = sqlite
        .prepare(
          `SELECT returned_quantity, source_order_item_id FROM order_items WHERE id = 1`,
        )
        .get() as { returned_quantity: number; source_order_item_id: number | null };
      expect(row.returned_quantity).toBe(0);
      expect(row.source_order_item_id).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  it("source_order_item_id uses ON DELETE SET NULL semantics", () => {
    for (const file of files) rmSync(file, { force: true });
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const sqlite = new Database(databasePath);
    try {
      sqlite.pragma("foreign_keys = ON");
      for (const migration of managerApprovalMigrationPaths) {
        sqlite.exec(readFileSync(path.resolve(migration), "utf8"));
      }
      const fk = sqlite
        .prepare(`PRAGMA foreign_key_list('order_items')`)
        .all() as Array<{ table: string; from: string; on_delete: string }>;
      const lineage = fk.find((row) => row.from === "source_order_item_id");
      expect(lineage?.table).toBe("order_items");
      expect(lineage?.on_delete?.toLowerCase()).toBe("set null");
    } finally {
      sqlite.close();
    }
  });

  it("deleting a source OrderItem nulls child lineage and does not block deletion", () => {
    for (const file of files) rmSync(file, { force: true });
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const sqlite = new Database(databasePath);
    try {
      sqlite.pragma("foreign_keys = ON");
      for (const migration of managerApprovalMigrationPaths) {
        sqlite.exec(readFileSync(path.resolve(migration), "utf8"));
      }
      sqlite.exec(`
        INSERT INTO "roles" ("id", "created_at", "updated_at", "is_active", "name")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'Cashier');
        INSERT INTO "users" ("id", "created_at", "updated_at", "is_active", "username", "full_name", "password_hash", "role_id")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'u', 'U', 'hash', 1);
        INSERT INTO "product_categories" ("id", "created_at", "updated_at", "is_active", "name")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'G');
        INSERT INTO "products" ("id", "created_at", "updated_at", "is_active", "name", "base_price", "cost_price", "category_id", "current_stock", "reorder_level")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'P', 100, 50, 1, 10, 0);
        INSERT INTO "orders" ("id", "created_at", "updated_at", "is_active", "order_number", "order_type", "status", "sub_total", "grand_total")
        VALUES
          (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'ORD-1', 'WalkIn', 'Closed', 100, 100),
          (2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'REF-1', 'Refund', 'Closed', -50, -50);
        INSERT INTO "order_items" ("id", "created_at", "updated_at", "is_active", "order_id", "product_id", "quantity", "unit_price", "line_total", "status", "returned_quantity")
        VALUES (1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, 1, 2, 50, 100, 'Closed', 1);
        INSERT INTO "order_items" ("id", "created_at", "updated_at", "is_active", "order_id", "product_id", "quantity", "unit_price", "line_total", "status", "returned_quantity", "source_order_item_id")
        VALUES (2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 2, 1, -1, 50, -50, 'Closed', 0, 1);
      `);
      sqlite.prepare(`DELETE FROM order_items WHERE id = 1`).run();
      const child = sqlite
        .prepare(
          `SELECT source_order_item_id FROM order_items WHERE id = 2`,
        )
        .get() as { source_order_item_id: number | null };
      expect(child.source_order_item_id).toBeNull();
    } finally {
      sqlite.close();
    }
  });
});
