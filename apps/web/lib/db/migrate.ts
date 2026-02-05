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

import { config } from 'dotenv'

// Load environment variables from .env files (order matters - .env.local takes priority)
config({ path: '.env.local' })
config({ path: '.env' })

import mysql from 'mysql2/promise'
import { readMigrationFiles, type MigrationConfig } from 'drizzle-orm/migrator'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIGRATIONS_TABLE = '__drizzle_migrations'
const MIGRATIONS_FOLDER = path.join(__dirname, 'migrations')

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set')
    process.exit(1)
  }

  console.log('🔌 Connecting to database...')

  const connection = await mysql.createConnection(databaseUrl)

  try {
    const migrationConfig: MigrationConfig = {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsTable: MIGRATIONS_TABLE,
    }

    // Read all migration files
    const allMigrations = readMigrationFiles(migrationConfig)
    console.log(`📁 Found ${allMigrations.length} migration file(s)`)

    // Check if migrations table exists
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [MIGRATIONS_TABLE]
    )
    const migrationsTableExists = tables.length > 0

    // Get list of all user tables (excluding system tables)
    const [userTables] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME NOT LIKE '\\_%'
       AND TABLE_NAME != ?`,
      [MIGRATIONS_TABLE]
    )
    const hasUserTables = userTables.length > 0

    console.log(`📊 Database state: ${userTables.length} user tables, migrations table: ${migrationsTableExists ? 'exists' : 'missing'}`)

    // Get applied migrations from database
    let appliedHashes: string[] = []
    if (migrationsTableExists) {
      const [applied] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT hash FROM \`${MIGRATIONS_TABLE}\``
      )
      appliedHashes = applied.map((row) => row.hash)
      console.log(`📋 Found ${appliedHashes.length} recorded migration(s) in database`)
    }

    // Calculate pending migrations
    const pendingMigrations = allMigrations.filter((m) => !appliedHashes.includes(m.hash))

    // Detect if we need to create a baseline
    // This happens when:
    // 1. Tables exist but no migrations are tracked
    // 2. OR tables exist and we have pending migrations that would fail (CREATE TABLE for existing tables)
    const needsBaseline = hasUserTables && pendingMigrations.length > 0 && (
      !migrationsTableExists || appliedHashes.length === 0
    )

    if (needsBaseline) {
      console.log('⚠️  Database has tables but migrations are not properly tracked')
      console.log('📝 Creating baseline (marking existing schema migrations as applied)...')

      // Determine which migrations to mark as applied
      // We check if the first migration would try to create a table that exists
      const firstPending = pendingMigrations[0]
      const isInitialMigrationPending = firstPending && allMigrations[0]?.hash === firstPending.hash

      if (isInitialMigrationPending) {
        // The initial migration is pending, which means all current migrations should be baselined
        await createBaseline(connection, allMigrations)
        console.log('✅ Baseline created - all current migrations marked as applied')
        console.log('✅ Database is up to date.')
        return
      }
    }

    // Check if pending migrations would fail due to existing tables/columns (partial baseline case)
    // This handles cases where db:push was used after some migrations were already recorded
    if (pendingMigrations.length > 0) {
      const existingTableNames = userTables.map((t) => t.TABLE_NAME.toLowerCase())

      // Get all existing columns for conflict detection
      const [existingColumns] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
      )
      const existingColumnSet = new Set(
        existingColumns.map((c) => `${c.TABLE_NAME.toLowerCase()}.${c.COLUMN_NAME.toLowerCase()}`)
      )

      // Check if any pending migration tries to CREATE TABLE or ADD COLUMN for existing schema
      const migrationsToSkip: typeof pendingMigrations = []
      for (const migration of pendingMigrations) {
        // migration.sql is an array of SQL statements
        const sqlStatements = Array.isArray(migration.sql) ? migration.sql.join('\n') : migration.sql
        let shouldSkip = false

        // Check for CREATE TABLE statements
        const createTableMatches = sqlStatements.matchAll(/CREATE TABLE [`"]?(\w+)[`"]?/gi)
        for (const match of createTableMatches) {
          const tableName = match[1].toLowerCase()
          if (existingTableNames.includes(tableName)) {
            migrationsToSkip.push(migration)
            console.log(`⚠️  Skipping migration (table '${match[1]}' already exists): ${migration.hash.substring(0, 8)}...`)
            shouldSkip = true
            break
          }
        }

        // Check for ALTER TABLE ADD COLUMN statements
        if (!shouldSkip) {
          const alterTableMatches = sqlStatements.matchAll(/ALTER TABLE [`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/gi)
          for (const match of alterTableMatches) {
            const tableName = match[1].toLowerCase()
            const columnName = match[2].toLowerCase()
            const key = `${tableName}.${columnName}`
            if (existingColumnSet.has(key)) {
              migrationsToSkip.push(migration)
              console.log(`⚠️  Skipping migration (column '${match[1]}.${match[2]}' already exists): ${migration.hash.substring(0, 8)}...`)
              shouldSkip = true
              break
            }
          }
        }
      }

      // Mark skipped migrations as applied without running them
      if (migrationsToSkip.length > 0) {
        console.log(`📝 Marking ${migrationsToSkip.length} migration(s) as applied (tables already exist)...`)

        // Ensure migrations table exists
        await connection.query(`
          CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
            \`id\` SERIAL PRIMARY KEY,
            \`hash\` text NOT NULL,
            \`created_at\` bigint
          )
        `)

        const now = Date.now()
        for (const migration of migrationsToSkip) {
          await connection.query(
            `INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`,
            [migration.hash, now]
          )
        }

        // Recalculate pending migrations
        const [newApplied] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT hash FROM \`${MIGRATIONS_TABLE}\``
        )
        const newAppliedHashes = newApplied.map((row) => row.hash)
        const remainingPending = allMigrations.filter((m) => !newAppliedHashes.includes(m.hash))

        if (remainingPending.length === 0) {
          console.log('✅ Database is up to date.')
          return
        }

        console.log(`🚀 Running ${remainingPending.length} remaining migration(s)...`)
      }
    }

    // Recalculate truly pending migrations (after any skips above)
    const [latestApplied] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT hash FROM \`${MIGRATIONS_TABLE}\``
    )
    const latestAppliedHashes = new Set(latestApplied.map((row) => row.hash))
    const trulyPending = allMigrations.filter((m) => !latestAppliedHashes.has(m.hash))

    // Run pending migrations directly (bypasses Drizzle's migrate() which can silently skip migrations)
    if (trulyPending.length === 0) {
      console.log('✅ Database is up to date. No pending migrations.')
    } else {
      console.log(`🚀 Running ${trulyPending.length} pending migration(s)...`)

      // Ensure migrations table exists
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
          \`id\` SERIAL PRIMARY KEY,
          \`hash\` text NOT NULL,
          \`created_at\` bigint
        )
      `)

      const now = Date.now()
      for (const migration of trulyPending) {
        const statements: string[] = Array.isArray(migration.sql) ? migration.sql : [migration.sql]

        for (const sql of statements) {
          const trimmed = sql.trim()
          if (trimmed.length === 0) continue

          try {
            await connection.query(trimmed)
          } catch (error) {
            // Handle idempotent cases gracefully
            const err = error as { code?: string; sqlMessage?: string }
            if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_TABLE_EXISTS_ERROR') {
              console.log(`   ⚠️  Skipped (already exists): ${err.sqlMessage}`)
            } else {
              throw error
            }
          }
        }

        // Record the migration hash
        await connection.query(
          `INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`,
          [migration.hash, now]
        )
        console.log(`   ✅ Applied: ${migration.hash.substring(0, 16)}...`)
      }

      console.log('✅ All migrations completed successfully!')
    }

  } catch (error) {
    console.error('❌ Migration failed:', error instanceof Error ? error.message : error)

    // Provide helpful context for common errors
    if (error instanceof Error && error.message.includes('already exists')) {
      console.error('')
      console.error('💡 This error means the database schema already exists but migrations')
      console.error('   are not properly tracked. This can happen if:')
      console.error('   - The database was initially set up with `pnpm db:push`')
      console.error('   - The __drizzle_migrations table was deleted or corrupted')
      console.error('')
      console.error('   To fix this manually, run: pnpm db:baseline')
    }

    process.exit(1)
  } finally {
    await connection.end()
    console.log('🔌 Database connection closed.')
  }
}

/**
 * Creates a baseline for existing databases.
 * This marks migrations as "applied" without actually running them,
 * since the schema already exists from db:push.
 */
async function createBaseline(
  connection: mysql.Connection,
  migrationsToMark: ReturnType<typeof readMigrationFiles>
) {
  // Create migrations table with the exact schema Drizzle expects
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
      \`id\` SERIAL PRIMARY KEY,
      \`hash\` text NOT NULL,
      \`created_at\` bigint
    )
  `)

  // Clear any existing (possibly corrupt) entries
  await connection.query(`DELETE FROM \`${MIGRATIONS_TABLE}\``)

  // Insert all migrations as already applied
  const now = Date.now()
  for (const migration of migrationsToMark) {
    await connection.query(
      `INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`,
      [migration.hash, now]
    )
  }

  console.log(`   Marked ${migrationsToMark.length} migration(s) as applied`)
}

// Also export a baseline-only function for manual recovery
export async function createBaselineOnly() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set')
    process.exit(1)
  }

  console.log('🔌 Connecting to database...')
  const connection = await mysql.createConnection(databaseUrl)

  try {
    const migrationConfig: MigrationConfig = {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsTable: MIGRATIONS_TABLE,
    }

    const allMigrations = readMigrationFiles(migrationConfig)
    console.log(`📁 Found ${allMigrations.length} migration file(s)`)

    await createBaseline(connection, allMigrations)
    console.log('✅ Baseline created successfully!')

  } finally {
    await connection.end()
    console.log('🔌 Database connection closed.')
  }
}

// Check if running directly (not imported)
const isMainModule = process.argv[1]?.includes('migrate.ts') || process.argv[1]?.includes('migrate.js')

if (isMainModule) {
  // Check for --baseline flag
  if (process.argv.includes('--baseline')) {
    createBaselineOnly()
  } else {
    runMigrations()
  }
}
