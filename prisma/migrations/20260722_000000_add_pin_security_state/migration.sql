ALTER TABLE "users" ADD COLUMN "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "pin_last_failed_at" DATETIME;
ALTER TABLE "users" ADD COLUMN "pin_locked_until" DATETIME;

CREATE TABLE "pin_throttle_states" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" DATETIME NOT NULL,
    "locked_until" DATETIME,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "pin_throttle_states_scope_key_hash_key"
ON "pin_throttle_states"("scope", "key_hash");

CREATE INDEX "pin_throttle_states_expires_at_idx"
ON "pin_throttle_states"("expires_at");
