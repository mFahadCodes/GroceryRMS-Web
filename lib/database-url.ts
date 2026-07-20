import path from "node:path";

/** Resolve relative SQLite `file:` URLs to an absolute path from project cwd. */
export function resolveDatabaseUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }

  const filePath = databaseUrl.slice("file:".length);
  if (path.isAbsolute(filePath)) {
    return databaseUrl;
  }

  return `file:${path.join(process.cwd(), filePath)}`;
}
