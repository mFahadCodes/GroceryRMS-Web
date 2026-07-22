-- P0-A: durable financial idempotency for checkout and partial payment.
-- Scalar identifiers only (no FKs) so retention/deletion of users, orders,
-- sessions, or terminals is never blocked by replay records.
CREATE TABLE "idempotency_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "scope_hash" TEXT NOT NULL,
    "key_digest" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER NOT NULL,
    "terminal_scope" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" TEXT,
    "completed_at" DATETIME,
    "expires_at" DATETIME
);

CREATE UNIQUE INDEX "idempotency_records_scope_hash_key"
ON "idempotency_records"("scope_hash");

CREATE INDEX "idempotency_records_expires_at_idx"
ON "idempotency_records"("expires_at");
