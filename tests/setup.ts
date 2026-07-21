import path from "node:path";

const repositoryRoot = path.resolve(process.cwd());
const testDatabaseRoot = path.join(repositoryRoot, ".tmp");
const defaultTestDatabaseUrl = "file:./.tmp/groceryrms-test.db";
const databaseUrl = process.env.DATABASE_URL ?? defaultTestDatabaseUrl;

Object.assign(process.env, { NODE_ENV: "test" });
process.env.PIN_PEPPER ??=
  "test-only-pin-pepper-for-groceryrms-security-tests-2026";

if (!databaseUrl.startsWith("file:")) {
  throw new Error("Tests require a disposable SQLite file under .tmp");
}

const databasePathText = databaseUrl.slice("file:".length).split("?", 1)[0];
const databasePath = path.isAbsolute(databasePathText)
  ? path.normalize(databasePathText)
  : path.resolve(repositoryRoot, databasePathText);
const relativeToTestRoot = path.relative(testDatabaseRoot, databasePath);

if (path.basename(databasePath).toLowerCase() === "dev.db") {
  throw new Error("Tests must never use dev.db");
}

if (
  relativeToTestRoot === "" ||
  relativeToTestRoot.startsWith(`..${path.sep}`) ||
  relativeToTestRoot === ".." ||
  path.isAbsolute(relativeToTestRoot)
) {
  throw new Error("Test database must remain inside the repository .tmp directory");
}

process.env.DATABASE_URL = databaseUrl;
