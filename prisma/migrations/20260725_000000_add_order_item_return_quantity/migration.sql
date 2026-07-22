-- P0-C1: authoritative returned-quantity CAS counter + refund/return lineage.
-- returned_quantity defaults to 0 for existing rows (INSERT omits the column).
-- source_order_item_id is nullable lineage; ON DELETE SET NULL so source-item
-- deletion does not block. Legacy null-lineage merchandise returns are not
-- backfilled — runtime guard blocks further returns until reconciliation.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_order_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "variant_id" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,
    "notes" TEXT,
    "void_reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "weight_kg" DECIMAL,
    "scanned_barcode" TEXT,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,
    "source_order_item_id" INTEGER,
    CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "order_items_source_order_item_id_fkey" FOREIGN KEY ("source_order_item_id") REFERENCES "order_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_order_items" ("created_at", "id", "is_active", "line_total", "notes", "order_id", "product_id", "quantity", "scanned_barcode", "status", "unit_price", "updated_at", "variant_id", "void_reason", "weight_kg") SELECT "created_at", "id", "is_active", "line_total", "notes", "order_id", "product_id", "quantity", "scanned_barcode", "status", "unit_price", "updated_at", "variant_id", "void_reason", "weight_kg" FROM "order_items";
DROP TABLE "order_items";
ALTER TABLE "new_order_items" RENAME TO "order_items";
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "order_items_source_order_item_id_idx" ON "order_items"("source_order_item_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
