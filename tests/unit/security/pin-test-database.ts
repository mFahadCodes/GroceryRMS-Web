import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import Database from "better-sqlite3";

export const pinMigrationPaths = [
  "prisma/migrations/20260720_000000_baseline/migration.sql",
  "prisma/migrations/20260720_010000_authoritative_sessions/migration.sql",
  "prisma/migrations/20260721_000000_add_password_rotation_state/migration.sql",
  "prisma/migrations/20260722_000000_add_pin_security_state/migration.sql",
];

export function createPinTestDatabase(name: string) {
  const databasePath = path.resolve(`.tmp/${name}.test.db`);
  const files = [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ];
  const cleanup = () => {
    for (const file of files) rmSync(file, { force: true });
  };
  cleanup();
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  try {
    for (const migration of pinMigrationPaths) {
      sqlite.exec(readFileSync(path.resolve(migration), "utf8"));
    }
  } finally {
    sqlite.close();
  }
  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databasePath }),
  });
  return { client, cleanup, databasePath };
}

export async function seedPinUser(
  client: PrismaClient,
  input: {
    id: number;
    pin: string | null;
    isActive?: boolean;
    mustChangePassword?: boolean;
    permissionName?: string;
    accessLevel?: number;
  },
) {
  const roleId = input.id;
  await client.role.create({
    data: { id: roleId, name: `Role ${roleId}` },
  });
  if (input.permissionName) {
    const permission = await client.permission.create({
      data: { id: roleId, name: input.permissionName },
    });
    await client.rolePermission.create({
      data: {
        roleId,
        permissionId: permission.id,
        accessLevel: input.accessLevel ?? 5,
      },
    });
  }
  return client.user.create({
    data: {
      id: input.id,
      username: `pin-user-${input.id}`,
      fullName: `PIN User ${input.id}`,
      passwordHash: "test-only-password-hash",
      pin: input.pin,
      roleId,
      isActive: input.isActive ?? true,
      mustChangePassword: input.mustChangePassword ?? false,
    },
  });
}
