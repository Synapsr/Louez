/**
 * One throwaway MySQL database per test suite.
 *
 * `TEST_DATABASE_URL` points at a MySQL server whose user may create databases.
 * A database name in it is ignored: each suite creates `louez_<suite>_<random>`,
 * points `DATABASE_URL` at it, runs the migrations and drops it in `after`.
 *
 *   describe("…", { skip: skipWithoutTestDatabase() }, () => {
 *     let database: TestDatabase;
 *     before(async () => { database = await createTestDatabase("my_suite"); });
 *     after(async () => { await database?.drop(); });
 *   });
 *
 * Import `@louez/db` only after `createTestDatabase` resolves, with a dynamic
 * `import()`: its pool reads `DATABASE_URL` when the module loads. Loading it
 * also loads the cwd's `.env` files, through migrate.ts. The helper loads
 * migrate.ts first and drops what the files add, so suites see only the shell's
 * variables, as in CI. End the pool before `drop()`. Use one test database per
 * test file.
 *
 * This file reads `process.env` directly because it must run before any env
 * module of the app loads.
 */
import { randomBytes } from "node:crypto";

import mysql from "mysql2/promise";

import type { RunMigrationsOptions } from "../migrate";

export interface TestDatabase {
  /** The database name, `louez_<suite>_<random>`. */
  name: string;
  /** Its URL, also set as `DATABASE_URL`. */
  url: string;
  /**
   * A raw connection that maps dates as drizzle does (UTC strings), so raw
   * fixtures and drizzle reads agree. The caller ends it.
   */
  connect(): Promise<mysql.Connection>;
  /** Runs the pending migrations. Without a folder, the repo's full set. */
  migrate(options?: RunMigrationsOptions): Promise<void>;
  /** Drops the database. */
  drop(): Promise<void>;
}

const MYSQL_MAX_IDENTIFIER_LENGTH = 64;

/**
 * The `skip` option of a database suite. Skips without `TEST_DATABASE_URL`,
 * except under CI, where the suite runs and fails, so a missing variable cannot
 * turn every database suite into a silent skip.
 */
export function skipWithoutTestDatabase(): string | false {
  if (process.env.TEST_DATABASE_URL || process.env.CI) return false;
  return "TEST_DATABASE_URL is not set";
}

/**
 * Creates the suite's database, sets `DATABASE_URL` to it and migrates it,
 * with the repo's migrations unless `migrationsFolder` is given.
 */
export async function createTestDatabase(
  suite: string,
  options: RunMigrationsOptions = {},
): Promise<TestDatabase> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (!serverUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. In CI, pass it to the test task (turbo.json passThroughEnv).",
    );
  }

  const name = `louez_${suite.toLowerCase().replace(/[^a-z0-9_]/g, "_")}_${randomBytes(4).toString("hex")}`;
  if (name.length > MYSQL_MAX_IDENTIFIER_LENGTH) {
    throw new Error(`Test database name is too long: ${name}`);
  }

  const server = new URL(serverUrl);
  server.pathname = "/";
  const database = new URL(serverUrl);
  database.pathname = `/${name}`;
  const url = database.toString();

  const onServer = async (statement: string) => {
    const connection = await mysql.createConnection({ uri: server.toString() });
    try {
      await connection.query(statement);
    } finally {
      await connection.end();
    }
  };

  await onServer(`CREATE DATABASE \`${name}\``);
  process.env.DATABASE_URL = url;

  // On its first import, migrate.ts loads .env.local and .env from the cwd. It
  // keeps DATABASE_URL, which is already set, but adds the rest of a developer's
  // files. Drop what it adds, so a local run sees the environment CI sees.
  const envBefore = new Set(Object.keys(process.env));
  const { runMigrations } = await import("../migrate");
  for (const key of Object.keys(process.env)) {
    if (!envBefore.has(key)) delete process.env[key];
  }

  const testDatabase: TestDatabase = {
    name,
    url,
    connect: () => mysql.createConnection({ uri: url, timezone: "Z" }),
    migrate: (migrationOptions) => runMigrations(migrationOptions),
    drop: () => onServer(`DROP DATABASE IF EXISTS \`${name}\``),
  };

  try {
    await testDatabase.migrate(options);
  } catch (error) {
    await testDatabase.drop();
    throw error;
  }
  return testDatabase;
}
