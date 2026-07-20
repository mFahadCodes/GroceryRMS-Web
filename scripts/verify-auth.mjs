import { config } from "dotenv";
import path from "node:path";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

config({ path: ".env.local", override: true });

const username = process.env.SMOKE_ADMIN_USERNAME?.trim();
const password = process.env.SMOKE_ADMIN_PASSWORD;
const pin = process.env.SMOKE_ADMIN_PIN;

if (!username) {
  throw new Error("SMOKE_ADMIN_USERNAME is required for credential verification.");
}

if (!password) {
  throw new Error("SMOKE_ADMIN_PASSWORD is required for credential verification.");
}

const databaseUrl =
  process.env.DATABASE_URL?.startsWith("file:") &&
  !path.isAbsolute(process.env.DATABASE_URL.slice(5))
    ? `file:${path.join(process.cwd(), process.env.DATABASE_URL.slice(5))}`
    : process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for credential verification.");
}

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
});

try {
  const user = await prisma.user.findFirst({
    where: { username, isActive: true },
  });

  if (!user) {
    console.error("Credential verification failed: active user not found.");
    process.exitCode = 1;
  } else {
    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    const pinOk =
      pin === undefined
        ? null
        : user.pin === createHash("sha256").update(pin).digest("hex");

    console.log("SQLite connection: OK");
    console.log("User lookup: OK");
    console.log("Password verification:", passwordOk ? "OK" : "FAIL");
    console.log(
      "PIN verification:",
      pinOk === null ? "SKIPPED" : pinOk ? "OK" : "FAIL",
    );

    process.exitCode = passwordOk && pinOk !== false ? 0 : 1;
  }
} finally {
  await prisma.$disconnect();
}
