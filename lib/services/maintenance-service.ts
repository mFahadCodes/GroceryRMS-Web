import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { prisma } from "@/lib/prisma";
import { upsertSetting } from "@/lib/services/settings-service";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");

export function getSqliteFilePath(): string {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const resolved = resolveDatabaseUrl(databaseUrl);
  return resolved.replace(/^file:/, "");
}

export function getDatabaseSize() {
  const dbPath = getSqliteFilePath();
  const stats = fs.statSync(dbPath);
  return {
    sizeBytes: stats.size,
    sizeMB: Math.round((stats.size / (1024 * 1024)) * 100) / 100,
    path: dbPath,
    lastModified: stats.mtime.toISOString(),
  };
}

function ensureBackupDir() {
  const dir = path.join(process.cwd(), "backups");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function rotateBackups(keepLast = 7) {
  const dir = ensureBackupDir();
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith("GroceryRMS-") && name.endsWith(".db"))
    .map((name) => ({
      name,
      fullPath: path.join(dir, name),
      mtime: fs.statSync(path.join(dir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files.slice(keepLast)) {
    fs.unlinkSync(file.fullPath);
  }
}

export async function backupDb(): Promise<{
  filePath: string;
  fileName: string;
}> {
  return createBackupFile();
}

export async function createBackupFile(): Promise<{
  filePath: string;
  fileName: string;
}> {
  const dbPath = getSqliteFilePath();
  const dir = ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `GroceryRMS-${timestamp}.db`;
  const filePath = path.join(dir, fileName);

  const source = new Database(dbPath, { readonly: true });
  source.backup(filePath);
  source.close();

  rotateBackups(7);

  // System-generated marker: null actor denotes a genuine system operation.
  await upsertSetting(
    "LastBackupAt",
    {
      value: new Date().toISOString(),
      dataType: "string",
      group: "Backup",
    },
    { actorUserId: null },
  );

  return { filePath, fileName };
}

export function listBackupFiles() {
  const dir = ensureBackupDir();
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".db"))
    .map((filename) => {
      const fullPath = path.join(dir, filename);
      const stats = fs.statSync(fullPath);
      return {
        filename,
        sizeBytes: stats.size,
        sizeMB: Math.round((stats.size / (1024 * 1024)) * 100) / 100,
        createdAt: stats.birthtime.toISOString(),
        path: fullPath,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreDatabaseFromBackupFile(filename: string) {
  const safeName = path.basename(filename);
  if (safeName !== filename || safeName.includes("..")) {
    throw new Error("Invalid filename");
  }

  const dir = ensureBackupDir();
  const fullPath = path.join(dir, safeName);
  if (!fs.existsSync(fullPath)) {
    throw new Error("Backup file not found");
  }

  return restoreDatabase(fullPath);
}

export function validateSqliteFile(filePath: string): boolean {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(16);
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);
  return buffer.subarray(0, 16).equals(SQLITE_MAGIC);
}

export async function restoreDatabase(uploadedPath: string) {
  if (!validateSqliteFile(uploadedPath)) {
    throw new Error("Invalid SQLite database file");
  }

  const dbPath = getSqliteFilePath();
  await prisma.$disconnect();

  fs.copyFileSync(uploadedPath, dbPath);

  return { restored: true, path: dbPath };
}

const IMPORT_TABLES = [
  { table: "products", model: "product" as const },
  { table: "customers", model: "customer" as const },
  { table: "suppliers", model: "supplier" as const },
  { table: "employees", model: "employee" as const },
];

export async function smartImportDatabase(uploadedPath: string) {
  if (!validateSqliteFile(uploadedPath)) {
    throw new Error("Invalid SQLite database file");
  }

  const currentPath = getSqliteFilePath();
  const source = new Database(uploadedPath, { readonly: true });
  const target = new Database(currentPath);

  let rowsImported = 0;
  const tablesProcessed: string[] = [];

  try {
    for (const entry of IMPORT_TABLES) {
      const columns = target
        .prepare(`PRAGMA table_info(${entry.table})`)
        .all() as Array<{ name: string }>;
      const columnNames = columns.map((col) => col.name);
      if (columnNames.length === 0) continue;

      const existingIds = new Set(
        (
          target
            .prepare(`SELECT id FROM ${entry.table}`)
            .all() as Array<{ id: number }>
        ).map((row) => row.id),
      );

      const sourceRows = source
        .prepare(`SELECT * FROM ${entry.table}`)
        .all() as Array<Record<string, unknown>>;

      const missing = sourceRows.filter(
        (row) => typeof row.id === "number" && !existingIds.has(row.id),
      );

      if (missing.length === 0) {
        tablesProcessed.push(entry.table);
        continue;
      }

      const placeholders = columnNames.map(() => "?").join(", ");
      const insertSql = `INSERT INTO ${entry.table} (${columnNames.join(", ")}) VALUES (${placeholders})`;

      const insert = target.prepare(insertSql);
      const tx = target.transaction((rows: Array<Record<string, unknown>>) => {
        for (const row of rows) {
          const values = columnNames.map((col) => row[col] ?? null);
          insert.run(...values);
        }
      });

      tx(missing);
      rowsImported += missing.length;
      tablesProcessed.push(entry.table);
    }
  } finally {
    source.close();
    target.close();
  }

  return { tablesProcessed, rowsImported };
}
