import { config } from "dotenv";
import path from "node:path";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

config({ path: ".env.local", override: true });

const databaseUrl =
  process.env.DATABASE_URL?.startsWith("file:") &&
  !path.isAbsolute(process.env.DATABASE_URL.slice(5))
    ? `file:${path.join(process.cwd(), process.env.DATABASE_URL.slice(5))}`
    : process.env.DATABASE_URL;

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
});

const user = await prisma.user.findFirst({
  where: { username: "admin", isActive: true },
});

if (!user) {
  console.error("FAIL: admin user not found — run npm run db:seed");
  process.exit(1);
}

const passwordOk = await bcrypt.compare("Admin@123", user.passwordHash);
const pinOk =
  user.pin === createHash("sha256").update("1234").digest("hex");

console.log("SQLite connection: OK");
console.log("admin user: OK");
console.log("password Admin@123:", passwordOk ? "OK" : "FAIL");
console.log("PIN 1234:", pinOk ? "OK" : "FAIL");

await prisma.$disconnect();
process.exit(passwordOk && pinOk ? 0 : 1);
