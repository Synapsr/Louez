import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { Connection, RowDataPacket } from "mysql2/promise";

import {
  createTestDatabase,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "./testing/test-database";

// In the cloud, the billing service shares Louez's database and may migrate it
// first. Its tables alone must not make Louez's setup refuse the database, nor
// make the migrations baseline an empty schema.

const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));
const DOCKER_MIGRATOR = fileURLToPath(new URL("../../../docker/migrate.mjs", import.meta.url));
const execFileAsync = promisify(execFile);

/** An empty journal: a database migrated with it starts with no table at all. */
async function emptyJournal(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "louez-no-migrations-"));
  await mkdir(path.join(folder, "meta"));
  await writeFile(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ version: "5", dialect: "mysql", entries: [] }),
  );
  return folder;
}

/** What the service's first migration leaves behind. */
async function addServiceTables(connection: Connection): Promise<void> {
  await connection.query(
    `CREATE TABLE billing_service_stores (
       id varchar(64) NOT NULL PRIMARY KEY
     ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  );
  await connection.query(`INSERT INTO billing_service_stores (id) VALUES ('service_row')`);
  await connection.query(
    `CREATE TABLE __billing_service_migrations (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
     )`,
  );
  await connection.query(
    `INSERT INTO __billing_service_migrations (hash, created_at) VALUES ('service_hash', 1)`,
  );
}

async function tableNames(connection: Connection): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
  );
  return rows.map((row) => String(row.name));
}

/** Every Louez migration is recorded, none of the service's, and its tables are untouched. */
async function assertMigratedNextToService(connection: Connection): Promise<void> {
  // Imported late: migrate.ts loads .env files on its first import, which
  // createTestDatabase handles.
  const { CORE_TABLES } = await import("./setup");
  const created = await tableNames(connection);
  for (const table of [...CORE_TABLES, "billing_sync_queue", "__drizzle_migrations"]) {
    assert.ok(created.includes(table), `${table} was created`);
  }

  const journal: { entries: unknown[] } = JSON.parse(
    await readFile(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"),
  );
  const [recorded] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n, SUM(hash = 'service_hash') AS service FROM __drizzle_migrations`,
  );
  assert.equal(Number(recorded[0]?.n), journal.entries.length, "every migration is recorded");
  assert.equal(Number(recorded[0]?.service), 0, "the service's migrations are not Louez's");

  const [serviceRows] = await connection.query<RowDataPacket[]>(
    `SELECT (SELECT COUNT(*) FROM billing_service_stores) AS stores,
            (SELECT COUNT(*) FROM __billing_service_migrations) AS migrations`,
  );
  assert.deepEqual(
    { stores: Number(serviceRows[0]?.stores), migrations: Number(serviceRows[0]?.migrations) },
    { stores: 1, migrations: 1 },
    "the service's tables are untouched",
  );
}

describe("billing service tables (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let connection: Connection;
  let setup: typeof import("./setup");
  let noMigrations: string;
  const migrationsFolderBefore = process.env.MIGRATIONS_FOLDER;

  before(async () => {
    noMigrations = await emptyJournal();
    database = await createTestDatabase("billing_service_tables", {
      migrationsFolder: noMigrations,
    });
    connection = await database.connect();
    assert.deepEqual(await tables(), [], "the database starts empty");

    await addServiceTables(connection);

    process.env.MIGRATIONS_FOLDER = MIGRATIONS;
    // DATABASE_URL now points at the test database; setup.ts reads it per call.
    setup = await import("./setup");
  });

  after(async () => {
    if (migrationsFolderBefore === undefined) delete process.env.MIGRATIONS_FOLDER;
    else process.env.MIGRATIONS_FOLDER = migrationsFolderBefore;
    await connection?.end();
    await database?.drop();
    if (noMigrations) await rm(noMigrations, { recursive: true, force: true });
  });

  const tables = () => tableNames(connection);

  /**
   * Runs setupDatabase. It exits the process when it fails: that exit becomes a
   * rejection that carries what it logged.
   */
  const runSetup = async () => {
    const logged: string[] = [];
    const log = mock.method(console, "log", (...args: unknown[]) => {
      logged.push(args.join(" "));
    });
    const exit = mock.method(process, "exit", (code?: number): never => {
      throw new Error(`setupDatabase exited with ${code}:\n${logged.join("\n")}`);
    });
    try {
      await setup.setupDatabase();
    } finally {
      exit.mock.restore();
      log.mock.restore();
    }
  };

  test("a table of another application, next to the service's, is still refused", async () => {
    await connection.query(`CREATE TABLE other_app_posts (id int PRIMARY KEY)`);
    try {
      await assert.rejects(runSetup(), /belong to another application/);
      assert.deepEqual(await tables(), [
        "__billing_service_migrations",
        "billing_service_stores",
        "other_app_posts",
      ]);
    } finally {
      await connection.query(`DROP TABLE other_app_posts`);
    }
  });

  test("with only the service's tables, setup runs every Louez migration", async () => {
    await runSetup();
    await assertMigratedNextToService(connection);
  });
});

describe(
  "billing service tables, Docker migrator (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let connection: Connection;
    let noMigrations: string;

    before(async () => {
      noMigrations = await emptyJournal();
      database = await createTestDatabase("billing_service_docker", {
        migrationsFolder: noMigrations,
      });
      connection = await database.connect();
      await addServiceTables(connection);
    });

    after(async () => {
      await connection?.end();
      await database?.drop();
      if (noMigrations) await rm(noMigrations, { recursive: true, force: true });
    });

    test("with only the service's tables, docker/migrate.mjs runs every Louez migration", async () => {
      // The image runs it with only the variables it is given.
      await execFileAsync(process.execPath, [DOCKER_MIGRATOR], {
        env: { PATH: process.env.PATH, DATABASE_URL: database.url, MIGRATIONS_FOLDER: MIGRATIONS },
      });
      await assertMigratedNextToService(connection);
    });
  },
);
