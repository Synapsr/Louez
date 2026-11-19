/**
 * Database Migration Script
 *
 * This script handles database migrations automatically:
 * - For new databases: runs all migrations from scratch
 * - For existing databases (created with db:push): creates baseline then runs new migrations
 *
 * How it works:
 * 1. Checks if __drizzle_migrations table exists
 * 2. If tables exist but migrations aren't tracked properly, creates a baseline
 * 3. Runs any pending migrations
 *
 * Usage:
 *   pnpm db:migrate:run     # Run migrations
 *   pnpm start:prod         # Runs migrations then starts the app
 */

import { config } from "dotenv";

// Load environment variables from .env files (order matters - .env.local takes priority)
config({ path: ".env.local" });
config({ path: ".env" });

import mysql from "mysql2/promise";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import { readMigrationFiles, type MigrationConfig } from "drizzle-orm/migrator";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_TABLE = "__drizzle_migrations";
const MIGRATIONS_FOLDER = path.join(__dirname, "migrations");

const NON_COLUMN_ADD_KEYWORDS = new Set([
  "primary",
  "unique",
  "key",
  "index",
  "constraint",
  "foreign",
  "check",
  "fulltext",
  "spatial",
]);

/**
 * Splits a migration's SQL chunks into individual executable statements,
 * stripping line comments and empty fragments.
 */
export function splitSqlStatements(sql: string | string[]): string[] {
  const chunks = Array.isArray(sql) ? sql : [sql];
  const result: string[] = [];

  for (const chunk of chunks) {
    const withoutComments = chunk.replace(/^\s*--.*$/gm, "").trim();
    if (!withoutComments) continue;

    // Split on semicolons at end-of-line or end-of-chunk so hand-written
    // multi-statement chunks are evaluated statement-by-statement.
    const parts = withoutComments.split(/;\s*(?:\r?\n|$)/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        result.push(trimmed);
      }
    }
  }

  return result;
}

/**
 * Determines whether a pending migration can be safely pre-skipped as already
 * applied (e.g. after `db:push`).
 *
 * IMPORTANT: A migration may ONLY be pre-skipped when EVERY statement in the
 * migration is a `CREATE TABLE` or `ALTER TABLE ... ADD [COLUMN]` statement
 * AND EVERY target table/column already exists in the database.
 * If even one target table/column is missing (or if the migration contains
 * other statements like `MODIFY`, `DROP`, `UPDATE`, `ADD CONSTRAINT/INDEX`),
 * it must NOT be skipped — the statement-by-statement executor will run it and
 * ignore `ER_DUP_FIELDNAME` / `ER_TABLE_EXISTS_ERROR` on already-existing items.
 */
export function shouldPreSkipPendingMigration(
  sql: string | string[],
  existingTableSet: ReadonlySet<string>,
  existingColumnSet: ReadonlySet<string>,
): { shouldSkip: boolean; reason?: string } {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    return { shouldSkip: false };
  }

  const matchedTargets: string[] = [];

  for (const stmt of statements) {
    const createTableMatch = stmt.match(
      /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(/i,
    );
    if (createTableMatch) {
      const tableName = createTableMatch[1].toLowerCase();
      if (!existingTableSet.has(tableName)) {
        return { shouldSkip: false };
      }
      matchedTargets.push(`table '${createTableMatch[1]}'`);
      continue;
    }

    const alterAddColumnMatch = stmt.match(
      /^ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?\s+/i,
    );
    if (alterAddColumnMatch) {
      // Do not pre-skip if the statement chains multiple clauses (e.g. ADD ..., DROP ...)
      // or if the token after ADD is a constraint/index keyword.
      const tableName = alterAddColumnMatch[1].toLowerCase();
      const columnName = alterAddColumnMatch[2].toLowerCase();
      if (NON_COLUMN_ADD_KEYWORDS.has(columnName)) {
        return { shouldSkip: false };
      }
      if (/\b(?:DROP|MODIFY|CHANGE|RENAME)\b/i.test(stmt)) {
        return { shouldSkip: false };
      }
      const allAddMatches = [
        ...stmt.matchAll(/\bADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/gi),
      ];
      if (allAddMatches.length === 0) {
        return { shouldSkip: false };
      }
      for (const addMatch of allAddMatches) {
        const col = addMatch[1].toLowerCase();
        if (NON_COLUMN_ADD_KEYWORDS.has(col)) {
          return { shouldSkip: false };
        }
        const key = `${tableName}.${col}`;
        if (!existingColumnSet.has(key)) {
          return { shouldSkip: false };
        }
        matchedTargets.push(`column '${alterAddColumnMatch[1]}.${addMatch[1]}'`);
      }
      continue;
    }

    // Any other SQL statement cannot be verified from table/column existence alone.
    return { shouldSkip: false };
  }

  if (matchedTargets.length === 0) {
    return { shouldSkip: false };
  }

  return {
    shouldSkip: true,
    reason: matchedTargets.join(", "),
  };
}

/**
 * Extracts all MySQL tables and their column names defined in `packages/db/src/schema.ts`.
 */
export function getExpectedSchemaTablesAndColumns(): Map<string, Set<string>> {
  const expected = new Map<string, Set<string>>();

  for (const value of Object.values(schema)) {
    if (is(value, MySqlTable)) {
      const config = getTableConfig(value);
      expected.set(
        config.name.toLowerCase(),
        new Set(config.columns.map((col) => col.name.toLowerCase())),
      );
    }
  }

  return expected;
}

/**
 * Scans all migrations for single-column `ALTER TABLE <table> ADD <column>`
 * statements that add a column required by the current Drizzle schema (`schema.ts`)
 * but missing from the live database (e.g. if an earlier migration was partially
 * skipped).
 */
export function findMissingSchemaColumnHealStatements(
  allMigrations: ReadonlyArray<{ sql: string | string[]; hash: string }>,
  existingTableSet: ReadonlySet<string>,
  existingColumnSet: ReadonlySet<string>,
  expectedSchema: ReadonlyMap<string, ReadonlySet<string>> = getExpectedSchemaTablesAndColumns(),
): Array<{ key: string; sql: string; migrationHash: string }> {
  const missingKeys = new Set<string>();

  for (const [tableName, columns] of expectedSchema.entries()) {
    if (!existingTableSet.has(tableName)) continue;
    for (const columnName of columns) {
      const key = `${tableName}.${columnName}`;
      if (!existingColumnSet.has(key)) {
        missingKeys.add(key);
      }
    }
  }

  if (missingKeys.size === 0) {
    return [];
  }

  const healStatements = new Map<string, { key: string; sql: string; migrationHash: string }>();

  for (const migration of allMigrations) {
    const statements = splitSqlStatements(migration.sql);
    for (const stmt of statements) {
      const match = stmt.match(
        /^ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?\s+/i,
      );
      if (!match) continue;

      const tableName = match[1].toLowerCase();
      const columnName = match[2].toLowerCase();
      if (NON_COLUMN_ADD_KEYWORDS.has(columnName)) continue;

      const key = `${tableName}.${columnName}`;
      if (missingKeys.has(key)) {
        healStatements.set(key, {
          key,
          sql: stmt,
          migrationHash: migration.hash,
        });
      }
    }
  }

  return [...healStatements.values()];
}

export interface RunMigrationsOptions {
  /**
   * Where to read migration .sql files from. Defaults to the folder next to
   * this file, which only exists when running from the repo (tsx/dev).
   * Bundled environments (Next.js standalone, Docker) must pass an explicit
   * path because __dirname points inside the bundle output.
   */
  migrationsFolder?: string;
}

export async function runMigrations(options: RunMigrationsOptions = {}) {
  const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  console.log("🔌 Connecting to database...");

  // multipleStatements: some hand-written migrations (e.g. 0032, 0034) hold
  // several statements in one chunk without --> statement-breakpoint markers
  const connection = await mysql.createConnection({
    uri: databaseUrl,
    multipleStatements: true,
  });

  try {
    const migrationConfig: MigrationConfig = {
      migrationsFolder,
      migrationsTable: MIGRATIONS_TABLE,
    };

    // Read all migration files
    const allMigrations = readMigrationFiles(migrationConfig);
    console.log(`📁 Found ${allMigrations.length} migration file(s)`);

    // Check if migrations table exists
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [MIGRATIONS_TABLE],
    );
    const migrationsTableExists = tables.length > 0;

    // Get list of all user tables (excluding system tables)
    const [userTables] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME NOT LIKE '\\_%'
       AND TABLE_NAME != ?`,
      [MIGRATIONS_TABLE],
    );
    const hasUserTables = userTables.length > 0;

    console.log(
      `📊 Database state: ${userTables.length} user tables, migrations table: ${migrationsTableExists ? "exists" : "missing"}`,
    );

    // Get applied migrations from database
    let appliedHashes: string[] = [];
    if (migrationsTableExists) {
      const [applied] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT hash FROM \`${MIGRATIONS_TABLE}\``,
      );
      appliedHashes = applied.map((row) => row.hash);
      console.log(`📋 Found ${appliedHashes.length} recorded migration(s) in database`);
    }

    // Calculate pending migrations
    const pendingMigrations = allMigrations.filter((m) => !appliedHashes.includes(m.hash));

    // Detect if we need to create a baseline
    // This happens when:
    // 1. Tables exist but no migrations are tracked
    // 2. OR tables exist and we have pending migrations that would fail (CREATE TABLE for existing tables)
    const needsBaseline =
      hasUserTables &&
      pendingMigrations.length > 0 &&
      (!migrationsTableExists || appliedHashes.length === 0);

    if (needsBaseline) {
      console.log("⚠️  Database has tables but migrations are not properly tracked");
      console.log("📝 Creating baseline (marking existing schema migrations as applied)...");

      // Determine which migrations to mark as applied
      // We check if the first migration would try to create a table that exists
      const firstPending = pendingMigrations[0];
      const isInitialMigrationPending =
        firstPending && allMigrations[0]?.hash === firstPending.hash;

      if (isInitialMigrationPending) {
        // The initial migration is pending, which means all current migrations should be baselined
        await createBaseline(connection, allMigrations);
        await verifyAndHealSchemaColumns(connection, allMigrations);
        console.log("✅ Baseline created - all current migrations marked as applied");
        console.log("✅ Database is up to date.");
        return;
      }
    }

    // Check if pending migrations are already fully satisfied by existing tables/columns
    // (partial baseline case where db:push was used after some migrations were recorded).
    // IMPORTANT: Only pre-skip a migration when EVERY statement in it is an already-existing
    // CREATE TABLE or ALTER TABLE ... ADD COLUMN.
    if (pendingMigrations.length > 0) {
      const existingTableSet = new Set(userTables.map((t) => t.TABLE_NAME.toLowerCase()));

      const [existingColumns] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
      );
      const existingColumnSet = new Set(
        existingColumns.map((c) => `${c.TABLE_NAME.toLowerCase()}.${c.COLUMN_NAME.toLowerCase()}`),
      );

      const migrationsToSkip: typeof pendingMigrations = [];
      for (const migration of pendingMigrations) {
        const decision = shouldPreSkipPendingMigration(
          migration.sql,
          existingTableSet,
          existingColumnSet,
        );
        if (decision.shouldSkip) {
          migrationsToSkip.push(migration);
          console.log(
            `⚠️  Skipping migration (${decision.reason} already exists): ${migration.hash.substring(0, 8)}...`,
          );
        }
      }

      // Mark fully-satisfied migrations as applied without re-running them
      if (migrationsToSkip.length > 0) {
        console.log(
          `📝 Marking ${migrationsToSkip.length} migration(s) as applied (all targets already exist)...`,
        );

        await connection.query(`
          CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
            \`id\` SERIAL PRIMARY KEY,
            \`hash\` text NOT NULL,
            \`created_at\` bigint
          )
        `);

        const now = Date.now();
        for (const migration of migrationsToSkip) {
          await connection.query(
            `INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`,
            [migration.hash, now],
          );
        }
      }
    }

    // Recalculate truly pending migrations (after any skips above).
    // The migrations table may still not exist here (fresh empty database).
    const [migrationsTableNow] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [MIGRATIONS_TABLE],
    );
    let latestAppliedHashes = new Set<string>();
    if (migrationsTableNow.length > 0) {
      const [latestApplied] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT hash FROM \`${MIGRATIONS_TABLE}\``,
      );
      latestAppliedHashes = new Set(latestApplied.map((row) => row.hash));
    }
    const trulyPending = allMigrations.filter((m) => !latestAppliedHashes.has(m.hash));

    // Run pending migrations directly (bypasses Drizzle's migrate() which can silently skip migrations)
    if (trulyPending.length === 0) {
      console.log("✅ Database is up to date. No pending migrations.");
    } else {
      console.log(`🚀 Running ${trulyPending.length} pending migration(s)...`);

      // Ensure migrations table exists
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
          \`id\` SERIAL PRIMARY KEY,
          \`hash\` text NOT NULL,
          \`created_at\` bigint
        )
      `);

      const now = Date.now();
      for (const migration of trulyPending) {
        const statements: string[] = Array.isArray(migration.sql) ? migration.sql : [migration.sql];

        for (const sql of statements) {
          const trimmed = sql.trim();
          if (trimmed.length === 0) continue;

          try {
            await connection.query(trimmed);
          } catch (error) {
            // Handle idempotent cases gracefully
            const err = error as { code?: string; sqlMessage?: string };
            if (
              err.code === "ER_DUP_FIELDNAME" ||
              err.code === "ER_DUP_KEYNAME" ||
              err.code === "ER_TABLE_EXISTS_ERROR" ||
              err.code === "ER_FK_DUP_NAME"
            ) {
              console.log(`   ⚠️  Skipped (already exists): ${err.sqlMessage}`);
            } else {
              throw error;
            }
          }
        }

        // Record the migration hash
        await connection.query(
          `INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`,
          [migration.hash, now],
        );
        console.log(`   ✅ Applied: ${migration.hash.substring(0, 16)}...`);
      }

      console.log("✅ All migrations completed successfully!");
    }

    // Self-heal & verify: ensure every column defined in packages/db/src/schema.ts
    // actually exists in the live database, even if an earlier migration hash was
    // prematurely marked as applied.
    await verifyAndHealSchemaColumns(connection, allMigrations);
  } catch (error) {
    console.error("❌ Migration failed:", error instanceof Error ? error.message : error);

    // Provide helpful context for common errors
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
 * Verifies that all columns defined in `packages/db/src/schema.ts` exist in the
 * live database, and automatically applies any missing `ALTER TABLE ... ADD`
 * statements from migrations if a migration was previously partially skipped.
 */
async function verifyAndHealSchemaColumns(
  connection: mysql.Connection,
  allMigrations: ReturnType<typeof readMigrationFiles>,
) {
  const [tables] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const existingTableSet = new Set(tables.map((t) => t.TABLE_NAME.toLowerCase()));

  const [columns] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const existingColumnSet = new Set(
    columns.map((c) => `${c.TABLE_NAME.toLowerCase()}.${c.COLUMN_NAME.toLowerCase()}`),
  );

  const expectedSchema = getExpectedSchemaTablesAndColumns();
  const healStatements = findMissingSchemaColumnHealStatements(
    allMigrations,
    existingTableSet,
    existingColumnSet,
    expectedSchema,
  );

  if (healStatements.length > 0) {
    console.log(
      `🔧 Healing ${healStatements.length} missing schema column(s) from migration history...`,
    );
    for (const heal of healStatements) {
      try {
        await connection.query(heal.sql);
        existingColumnSet.add(heal.key);
        console.log(`   ✅ Healed missing column: ${heal.key}`);
      } catch (error) {
        const err = error as { code?: string; sqlMessage?: string };
        if (err.code === "ER_DUP_FIELDNAME") {
          existingColumnSet.add(heal.key);
        } else {
          throw error;
        }
      }
    }
  }

  // Final verification against Drizzle schema
  const stillMissingColumns: string[] = [];
  for (const [tableName, expectedColumns] of expectedSchema.entries()) {
    if (!existingTableSet.has(tableName)) continue;
    for (const columnName of expectedColumns) {
      const key = `${tableName}.${columnName}`;
      if (!existingColumnSet.has(key)) {
        stillMissingColumns.push(key);
      }
    }
  }

  if (stillMissingColumns.length > 0) {
    throw new Error(
      `Database schema drift detected: missing column(s) [${stillMissingColumns.join(", ")}] required by @louez/db schema.ts`,
    );
  }
}

/**
 * Creates a baseline for existing databases.
 * This marks migrations as "applied" without actually running them,
 * since the schema already exists from db:push.
 */
async function createBaseline(
  connection: mysql.Connection,
  migrationsToMark: ReturnType<typeof readMigrationFiles>,
) {
  // Create migrations table with the exact schema Drizzle expects
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
      \`id\` SERIAL PRIMARY KEY,
      \`hash\` text NOT NULL,
      \`created_at\` bigint
    )
  `);

  // Clear any existing (possibly corrupt) entries
  await connection.query(`DELETE FROM \`${MIGRATIONS_TABLE}\``);

  // Insert all migrations as already applied
  const now = Date.now();
  for (const migration of migrationsToMark) {
    await connection.query(`INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`, [
      migration.hash,
      now,
    ]);
  }

  console.log(`   Marked ${migrationsToMark.length} migration(s) as applied`);
}

// Also export a baseline-only function for manual recovery
export async function createBaselineOnly() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("❌ DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("🔌 Connecting to database...");
  const connection = await mysql.createConnection(databaseUrl);

  try {
    const migrationConfig: MigrationConfig = {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsTable: MIGRATIONS_TABLE,
    };

    const allMigrations = readMigrationFiles(migrationConfig);
    console.log(`📁 Found ${allMigrations.length} migration file(s)`);

    await createBaseline(connection, allMigrations);
    console.log("✅ Baseline created successfully!");
  } finally {
    await connection.end();
    console.log("🔌 Database connection closed.");
  }
}

// Check if running directly (not imported)
const isMainModule =
  process.argv[1]?.includes("migrate.ts") || process.argv[1]?.includes("migrate.js");

if (isMainModule) {
  // Check for --baseline flag
  if (process.argv.includes("--baseline")) {
    createBaselineOnly();
  } else {
    runMigrations().catch(() => process.exit(1));
  }
}
