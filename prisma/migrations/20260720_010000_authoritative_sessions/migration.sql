-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN "auth_version" INTEGER;
ALTER TABLE "user_sessions" ADD COLUMN "expires_at" DATETIME;
ALTER TABLE "user_sessions" ADD COLUMN "revoked_reason" TEXT;
ALTER TABLE "user_sessions" ADD COLUMN "session_id" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "pin" TEXT,
    "role_id" INTEGER NOT NULL,
    "auth_version" INTEGER NOT NULL DEFAULT 1,
    "phone" TEXT,
    "email" TEXT,
    "last_login_at" DATETIME,
    CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_users" ("created_at", "email", "full_name", "id", "is_active", "last_login_at", "password_hash", "phone", "pin", "role_id", "updated_at", "username") SELECT "created_at", "email", "full_name", "id", "is_active", "last_login_at", "password_hash", "phone", "pin", "role_id", "updated_at", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_session_id_key" ON "user_sessions"("session_id");
