import mysql from 'mysql2/promise'
import fs from 'fs'
import path from 'path'
import { runMigrations } from './migrate'

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
}

function log(emoji: string, message: string, color: string = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`)
}

function logSection(title: string) {
  console.log('')
  console.log(`${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`)
  console.log(`${colors.bright}${colors.cyan}  ${title}${colors.reset}`)
  console.log(`${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`)
  console.log('')
}

// Core tables that should exist in a properly configured database
export const CORE_TABLES = ['users', 'accounts', 'sessions', 'stores', 'products', 'reservations']

const MIGRATIONS_TABLE = '__drizzle_migrations'

const CONNECT_RETRIES = 10
const CONNECT_RETRY_DELAY_MS = 3000

/**
 * Locate the drizzle migrations folder. The location differs by environment:
 * - Docker image: MIGRATIONS_FOLDER env var (set in the Dockerfile)
 * - Docker image fallback: ./migrations relative to WORKDIR
 * - Monorepo (next dev/start from apps/web or repo root)
 */
function resolveMigrationsFolder(): string | null {
  const candidates = [
    process.env.MIGRATIONS_FOLDER,
    path.join(process.cwd(), 'migrations'),
    path.join(process.cwd(), 'packages/db/src/migrations'),
    path.join(process.cwd(), '../../packages/db/src/migrations'),
  ].filter((c): c is string => Boolean(c))

  return (
    candidates.find((c) => fs.existsSync(path.join(c, 'meta', '_journal.json'))) ?? null
  )
}

async function connectWithRetry(databaseUrl: string): Promise<mysql.Connection> {
  let lastError: unknown
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    try {
      return await mysql.createConnection(databaseUrl)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      log('⏳', `Database not reachable (attempt ${attempt}/${CONNECT_RETRIES}): ${message}`, colors.yellow)
      if (attempt < CONNECT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS))
      }
    }
  }
  throw lastError
}

async function listTables(connection: mysql.Connection): Promise<string[]> {
  const [rows] = await connection.query('SHOW TABLES')
  return (rows as Array<Record<string, string>>).map((row) => Object.values(row)[0])
}

/**
 * Ensures the database schema is up to date at application startup.
 *
 * Runs the committed SQL migrations programmatically (drizzle-orm migrator) —
 * it deliberately does NOT shell out to drizzle-kit, which is a dev-only tool
 * that is not present in the production Docker image (see issue #28).
 *
 * Fails fast: if the schema cannot be set up, the process exits non-zero so
 * orchestrators surface a crash loop instead of a silently broken app.
 */
export async function setupDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL

  logSection('Database Setup')

  // Check if DATABASE_URL is configured
  if (!databaseUrl) {
    log('⚠️', 'DATABASE_URL is not configured. Skipping database setup.', colors.yellow)
    log('📝', 'Set DATABASE_URL in your environment to enable automatic setup.', colors.dim)
    return
  }

  let connection: mysql.Connection | null = null

  try {
    // Step 1: Connect (with retries — the database container may still be starting)
    log('🔌', 'Connecting to database...', colors.blue)
    connection = await connectWithRetry(databaseUrl)
    log('✅', 'Database connection successful!', colors.green)

    // Step 2: Safety check — refuse to touch a database that belongs to
    // another application (tables present, but none of ours and no migration
    // tracking table).
    log('📋', 'Checking existing tables...', colors.blue)
    const tables = await listTables(connection)
    const hasCoreTables = CORE_TABLES.some((table) => tables.includes(table))
    const hasMigrationsTable = tables.includes(MIGRATIONS_TABLE)

    if (tables.length > 0 && !hasCoreTables && !hasMigrationsTable) {
      log('⚠️', `Found ${tables.length} tables but none belong to Louez.`, colors.yellow)
      log('📝', `Existing tables: ${tables.join(', ')}`, colors.dim)
      throw new Error(
        'Database appears to belong to another application. Point DATABASE_URL at an empty or Louez database.'
      )
    }

    // Step 3: Run pending migrations (no-op when already up to date)
    const migrationsFolder = resolveMigrationsFolder()
    if (!migrationsFolder) {
      throw new Error(
        'Migrations folder not found. Set MIGRATIONS_FOLDER to the directory containing the drizzle migrations.'
      )
    }

    log('🚀', `Running database migrations from ${migrationsFolder}...`, colors.blue)
    console.log('')
    await runMigrations({ migrationsFolder })
    console.log('')

    // Step 4: Verify setup - this is the source of truth
    log('🔍', 'Verifying database setup...', colors.blue)
    const verifyTables = await listTables(connection)
    const missingAfterSetup = CORE_TABLES.filter((table) => !verifyTables.includes(table))

    if (missingAfterSetup.length > 0) {
      throw new Error(`Setup incomplete. Missing core tables: ${missingAfterSetup.join(', ')}`)
    }

    log('✅', `Database is ready with ${verifyTables.length} tables.`, colors.green)
    log('📦', `Core tables found: ${CORE_TABLES.join(', ')}`, colors.dim)

    logSection('Setup Complete')
    log('🎉', 'Your database is ready to use!', colors.green)
    console.log('')
  } catch (error) {
    console.log('')
    log('❌', 'Database setup failed!', colors.red)

    if (error instanceof Error) {
      // Provide helpful error messages based on common issues
      if (error.message.includes('ECONNREFUSED')) {
        log('💡', 'Could not connect to database. Is MySQL running?', colors.yellow)
      } else if (error.message.includes('Access denied')) {
        log('💡', 'Database credentials are incorrect. Check DATABASE_URL.', colors.yellow)
      } else if (error.message.includes('Unknown database')) {
        log('💡', 'Database does not exist. Create it first.', colors.yellow)
      } else {
        log('💡', `Error: ${error.message}`, colors.dim)
      }
    }

    // Fail fast: a broken schema means a broken app. Exiting non-zero puts
    // the container in a visible crash loop instead of serving errors.
    log('🛑', 'Exiting. Fix the issue above and restart the application.', colors.red)
    console.log('')
    process.exit(1)
  } finally {
    if (connection) {
      await connection.end()
    }
  }
}
