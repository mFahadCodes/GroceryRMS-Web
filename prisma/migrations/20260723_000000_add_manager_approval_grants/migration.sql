CREATE TABLE "manager_approval_grants" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token_hash" TEXT NOT NULL,
    "requester_user_id" INTEGER NOT NULL,
    "requester_session_id" INTEGER NOT NULL,
    "requester_auth_version" INTEGER NOT NULL,
    "approver_user_id" INTEGER NOT NULL,
    "approver_auth_version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" INTEGER NOT NULL,
    "required_permission" TEXT NOT NULL,
    "required_access_level" INTEGER NOT NULL,
    "terminal_id" INTEGER,
    "expires_at" DATETIME NOT NULL,
    "consumed_at" DATETIME,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manager_approval_grants_requester_user_id_fkey"
        FOREIGN KEY ("requester_user_id") REFERENCES "users" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "manager_approval_grants_requester_session_id_fkey"
        FOREIGN KEY ("requester_session_id") REFERENCES "user_sessions" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "manager_approval_grants_approver_user_id_fkey"
        FOREIGN KEY ("approver_user_id") REFERENCES "users" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "manager_approval_grants_resource_id_fkey"
        FOREIGN KEY ("resource_id") REFERENCES "orders" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "manager_approval_grants_terminal_id_fkey"
        FOREIGN KEY ("terminal_id") REFERENCES "terminals" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "manager_approval_grants_token_hash_key"
ON "manager_approval_grants"("token_hash");

CREATE INDEX "manager_approval_grants_requester_session_id_idx"
ON "manager_approval_grants"("requester_session_id");

CREATE INDEX "manager_approval_grants_approver_user_id_idx"
ON "manager_approval_grants"("approver_user_id");

CREATE INDEX "manager_approval_grants_expires_at_idx"
ON "manager_approval_grants"("expires_at");

CREATE INDEX "manager_approval_grants_resource_type_resource_id_action_idx"
ON "manager_approval_grants"("resource_type", "resource_id", "action");
