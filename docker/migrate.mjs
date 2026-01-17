/**
 * Database Migration Script for Docker
 *
 * This script runs database migrations at container startup.
 * It's designed to work in the Docker production environment where:
 * - Environment variables are passed directly (no .env files)
 * - The script runs before the Next.js server starts
 *
 * Features:
 * - Handles new databases (runs all migrations)
 * - Handles existing databases from db:push (creates baseline)
 * - Idempotent: safe to run multiple times
 */

import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import mysql from 'mysql2/promise'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const MIGRATIONS_TABLE = '__drizzle_migrations'

// Migrations folder is relative to where this script is executed (WORKDIR /app)
const MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER || './migrations'

/**
 * Read migration files manually (simplified version of Drizzle's reader)
 */
function readMigrationFiles(folder) {
  if (!fs.existsSync(folder)) {
    console.error(`❌ Migrations folder not found: ${folder}`)
    process.exit(1)
  }

  const metaPath = path.join(folder, 'meta', '_journal.json')
  if (!fs.existsSync(metaPath)) {
    console.error(`❌ Migration journal not found: ${metaPath}`)
    process.exit(1)
  }

  const journal = JSON.parse(fs.readFileSync(metaPath, 'utf8'))

  return journal.entries.map(entry => {
    const sqlPath = path.join(folder, `${entry.tag}.sql`)
    const sql = fs.readFileSync(sqlPath, 'utf8')
    const hash = crypto.createHash('sha256').update(sql).digest('hex')

    return {
      tag: entry.tag,
      sql,
      hash,
      idx: entry.idx
    }
  }).sort((a, b) => a.idx - b.idx)
}

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set')
    process.exit(1)
  }

  console.log('🔌 Connecting to database...')

  let connection
  try {
    connection = await mysql.createConnection(databaseUrl)
  } catch (error) {
    console.error('❌ Failed to connect to database:', error.message)
    console.error('   Make sure the database is running and DATABASE_URL is correct')
    process.exit(1)
  }

  try {
    // Read all migration files
    const allMigrations = readMigrationFiles(MIGRATIONS_FOLDER)
    console.log(`📁 Found ${allMigrations.length} migration file(s)`)

    // Check if migrations table exists
    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [MIGRATIONS_TABLE]
    )
    const migrationsTableExists = tables.length > 0

    // Get list of all user tables (excluding system tables)
    const [userTables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME NOT LIKE '\\_%'
       AND TABLE_NAME != ?`,
      [MIGRATIONS_TABLE]
    )
    const hasUserTables = userTables.length > 0

    console.log(`📊 Database state: ${userTables.length} user tables, migrations table: ${migrationsTableExists ? 'exists' : 'missing'}`)

    // Get applied migrations from database
    let appliedHashes = []
    if (migrationsTableExists) {
      const [applied] = await connection.query(
        `SELECT hash FROM \`${MIGRATIONS_TABLE}\``
      )
      appliedHashes = applied.map(row => row.hash)
      console.log(`📋 Found ${appliedHashes.length} recorded migration(s) in database`)
    }

    // Calculate pending migrations
    const pendingMigrations = allMigrations.filter(m => !appliedHashes.includes(m.hash))

    // Detect if we need to create a baseline
    const needsBaseline = hasUserTables && pendingMigrations.length > 0 && (
      !migrationsTableExists || appliedHashes.length === 0
    )

    if (needsBaseline) {
      console.log('⚠️  Database has tables but migrations are not properly tracked')
      console.log('📝 Creating baseline (marking existing schema migrations as applied)...')

      // Check if the first migration would try to create existing tables
      const firstPending = pendingMigrations[0]
      const isInitialMigrationPending = firstPending && allMigrations[0]?.hash === firstPending.hash

      if (isInitialMigrationPending) {
        await createBaseline(connection, allMigrations)
        console.log('✅ Baseline created - all current migrations marked as applied')
        console.log('✅ Database is up to date.')
        return
      }
    }

    // Run pending migrations
    if (pendingMigrations.length === 0) {
      console.log('✅ Database is up to date. No pending migrations.')
    } else {
      console.log(`🚀 Running ${pendingMigrations.length} pending migration(s)...`)

      const db = drizzle(connection)
      await migrate(db, {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsTable: MIGRATIONS_TABLE,
      })

      console.log('✅ All migrations completed successfully!')
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message)

    if (error.message?.includes('already exists')) {
      console.error('')
      console.error('💡 This error usually means the database schema already exists')
      console.error('   but migrations are not properly tracked. The baseline should')
      console.error('   have been created automatically. Please check the logs above.')
    }

    process.exit(1)
  } finally {
    await connection.end()
    console.log('🔌 Database connection closed.')
  }
}

/**
 * Creates a baseline for existing databases.
 */
async function createBaseline(connection, migrationsToMark) {
  // Create migrations table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
      \`id\` SERIAL PRIMARY KEY,
      \`hash\` text NOT NULL,
      \`created_at\` bigint
    )
  `)

  // Clear any existing entries
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

// Run migrations
runMigrations()
