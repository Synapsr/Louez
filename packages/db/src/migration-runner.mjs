// @ts-check
/**
 * The one migration runner, for every way Louez migrates a database: the app at
 * startup (setup.ts), `pnpm db:migrate:run` (migrate.ts) and the Docker migrator
 * image (docker/migrate.mjs). Plain JavaScript, so the image runs it without
 * TypeScript.
 *
 * A migration is applied when the SHA-256 of its SQL file is in
 * `__drizzle_migrations`; its name, number and journal `when` play no part.
 * Drizzle's own `migrate()` decides by `created_at` against `when` instead, and
 * skips migrations on a database this runner migrated: it is not used.
 *
 * - A new database runs every migration.
 * - Tables without any tracking (a `db:push` database) get a baseline.
 * - A pending migration whose table or column already exists is marked applied
 *   without running.
 */

import mysql from "mysql2/promise";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { isBillingServiceTable } from "./billing-service-tables.mjs";

export const MIGRATIONS_TABLE = "__drizzle_migrations";

/** @typedef {ReturnType<typeof readMigrationFiles>} MigrationFiles */

/**
 * @param {mysql.Connection} connection
 */
async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
      \`id\` SERIAL PRIMARY KEY,
      \`hash\` text NOT NULL,
      \`created_at\` bigint
    )
  `);
}

/**
 * @param {mysql.Connection} connection
 * @returns {Promise<string[]>}
 */
async function appliedHashes(connection) {
  const [rows] = /** @type {[mysql.RowDataPacket[], unknown]} */ (
    await connection.query(`SELECT hash FROM \`${MIGRATIONS_TABLE}\``)
  );
  return rows.map((row) => String(row.hash));
}

/**
 * Marks migrations as applied without running them, for a schema that exists
 * already (db:push). Clears whatever was recorded before.
 *
 * @param {mysql.Connection} connection
 * @param {MigrationFiles} migrationsToMark
 */
async function createBaseline(connection, migrationsToMark) {
  await ensureMigrationsTable(connection);
  await connection.query(`DELETE FROM \`${MIGRATIONS_TABLE}\``);
  const now = Date.now();
  for (const migration of migrationsToMark) {
    await connection.query(`INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`, [
      migration.hash,
      now,
    ]);
  }
  console.log(`   Marked ${migrationsToMark.length} migration(s) as applied`);
}

/**
 * Runs the pending migrations of `migrationsFolder` on `databaseUrl`. Throws
 * when one fails; what ran before it stays recorded.
 *
 * @param {{ databaseUrl: string; migrationsFolder: string }} options
 */
export async function runMigrations({ databaseUrl, migrationsFolder }) {
  console.log("🔌 Connecting to database...");

  // multipleStatements: some hand-written migrations (e.g. 0032, 0034) hold
  // several statements in one chunk without --> statement-breakpoint markers
  const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });

  try {
    const allMigrations = readMigrationFiles({
      migrationsFolder,
      migrationsTable: MIGRATIONS_TABLE,
    });
    console.log(`📁 Found ${allMigrations.length} migration file(s)`);

    const [tables] = /** @type {[mysql.RowDataPacket[], unknown]} */ (
      await connection.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [MIGRATIONS_TABLE],
      )
    );
    const migrationsTableExists = tables.length > 0;

    // The billing service's tables are not Louez's: on an empty database where
    // the service migrated first, they must not trigger a baseline.
    const [allUserTables] = /** @type {[mysql.RowDataPacket[], unknown]} */ (
      await connection.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME NOT LIKE '\\_%'
         AND TABLE_NAME != ?`,
        [MIGRATIONS_TABLE],
      )
    );
    const userTables = allUserTables.filter(
      (table) => !isBillingServiceTable(String(table.TABLE_NAME)),
    );
    const hasUserTables = userTables.length > 0;

    console.log(
      `📊 Database state: ${userTables.length} user tables, migrations table: ${migrationsTableExists ? "exists" : "missing"}`,
    );

    /** @type {string[]} */
    let applied = [];
    if (migrationsTableExists) {
      applied = await appliedHashes(connection);
      console.log(`📋 Found ${applied.length} recorded migration(s) in database`);
    }

    const pendingMigrations = allMigrations.filter((m) => !applied.includes(m.hash));

    // Tables exist but no migration is tracked: a schema made with db:push.
    const needsBaseline =
      hasUserTables && pendingMigrations.length > 0 && (!migrationsTableExists || applied.length === 0);

    if (needsBaseline) {
      console.log("⚠️  Database has tables but migrations are not properly tracked");
      console.log("📝 Creating baseline (marking existing schema migrations as applied)...");

      const firstPending = pendingMigrations[0];
      const isInitialMigrationPending = firstPending && allMigrations[0]?.hash === firstPending.hash;

      if (isInitialMigrationPending) {
        await createBaseline(connection, allMigrations);
        console.log("✅ Baseline created - all current migrations marked as applied");
        console.log("✅ Database is up to date.");
        return;
      }
    }

    // A pending migration that creates a table or adds a column that exists
    // already (db:push after some migrations were recorded) is marked applied.
    if (pendingMigrations.length > 0) {
      const existingTableNames = userTables.map((t) => String(t.TABLE_NAME).toLowerCase());

      const [existingColumns] = /** @type {[mysql.RowDataPacket[], unknown]} */ (
        await connection.query(
          `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
        )
      );
      const existingColumnSet = new Set(
        existingColumns.map(
          (c) => `${String(c.TABLE_NAME).toLowerCase()}.${String(c.COLUMN_NAME).toLowerCase()}`,
        ),
      );

      /** @type {MigrationFiles} */
      const migrationsToSkip = [];
      for (const migration of pendingMigrations) {
        const sqlStatements = migration.sql.join("\n");
        let shouldSkip = false;

        for (const match of sqlStatements.matchAll(/CREATE TABLE [`"]?(\w+)[`"]?/gi)) {
          if (existingTableNames.includes(match[1].toLowerCase())) {
            migrationsToSkip.push(migration);
            console.log(
              `⚠️  Skipping migration (table '${match[1]}' already exists): ${migration.hash.substring(0, 8)}...`,
            );
            shouldSkip = true;
            break;
          }
        }

        if (!shouldSkip) {
          const alterTableMatches = sqlStatements.matchAll(
            /ALTER TABLE [`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/gi,
          );
          for (const match of alterTableMatches) {
            const key = `${match[1].toLowerCase()}.${match[2].toLowerCase()}`;
            if (existingColumnSet.has(key)) {
              migrationsToSkip.push(migration);
              console.log(
                `⚠️  Skipping migration (column '${match[1]}.${match[2]}' already exists): ${migration.hash.substring(0, 8)}...`,
              );
              break;
            }
          }
        }
      }

      if (migrationsToSkip.length > 0) {
        console.log(
          `📝 Marking ${migrationsToSkip.length} migration(s) as applied (tables already exist)...`,
        );
        await ensureMigrationsTable(connection);
        const now = Date.now();
        for (const migration of migrationsToSkip) {
          await connection.query(
            `INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`,
            [migration.hash, now],
          );
        }
      }
    }

    // The migrations table may still not exist here (fresh empty database).
    const [tablesNow] = /** @type {[mysql.RowDataPacket[], unknown]} */ (
      await connection.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [MIGRATIONS_TABLE],
      )
    );
    const latestApplied = new Set(tablesNow.length > 0 ? await appliedHashes(connection) : []);
    const trulyPending = allMigrations.filter((m) => !latestApplied.has(m.hash));

    if (trulyPending.length === 0) {
      console.log("✅ Database is up to date. No pending migrations.");
      return;
    }

    console.log(`🚀 Running ${trulyPending.length} pending migration(s)...`);
    await ensureMigrationsTable(connection);
    const now = Date.now();
    for (const migration of trulyPending) {
      for (const sql of migration.sql) {
        const trimmed = sql.trim();
        if (trimmed.length === 0) continue;
        try {
          await connection.query(trimmed);
        } catch (error) {
          // Handle idempotent cases gracefully
          const err = /** @type {{ code?: string; sqlMessage?: string }} */ (error);
          if (
            err.code === "ER_DUP_FIELDNAME" ||
            err.code === "ER_DUP_KEYNAME" ||
            err.code === "ER_TABLE_EXISTS_ERROR"
          ) {
            console.log(`   ⚠️  Skipped (already exists): ${err.sqlMessage}`);
          } else {
            throw error;
          }
        }
      }
      await connection.query(`INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`, [
        migration.hash,
        now,
      ]);
      console.log(`   ✅ Applied: ${migration.hash.substring(0, 16)}...`);
    }
    console.log("✅ All migrations completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.message.includes("already exists")) {
      console.error("");
      console.error("💡 This error means the database schema already exists but migrations");
      console.error("   are not properly tracked. This can happen if:");
      console.error("   - The database was initially set up with `pnpm db:push`");
      console.error("   - The __drizzle_migrations table was deleted or corrupted");
      console.error("");
      console.error("   To fix this manually, run: pnpm db:baseline");
    }
    throw error;
  } finally {
    await connection.end();
    console.log("🔌 Database connection closed.");
  }
}

/**
 * Marks every migration of `migrationsFolder` as applied, for manual recovery.
 *
 * @param {{ databaseUrl: string; migrationsFolder: string }} options
 */
export async function createBaselineOnly({ databaseUrl, migrationsFolder }) {
  console.log("🔌 Connecting to database...");
  const connection = await mysql.createConnection(databaseUrl);
  try {
    const allMigrations = readMigrationFiles({ migrationsFolder, migrationsTable: MIGRATIONS_TABLE });
    console.log(`📁 Found ${allMigrations.length} migration file(s)`);
    await createBaseline(connection, allMigrations);
    console.log("✅ Baseline created successfully!");
  } finally {
    await connection.end();
    console.log("🔌 Database connection closed.");
  }
}
