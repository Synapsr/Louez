import mysql from 'mysql2/promise'
import { execSync } from 'child_process'

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
const CORE_TABLES = ['users', 'accounts', 'sessions', 'stores', 'products', 'reservations']

export async function setupDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL

  logSection('Database Setup')

  // Check if DATABASE_URL is configured
  if (!databaseUrl) {
    log('⚠️', 'DATABASE_URL is not configured. Skipping database setup.', colors.yellow)
    log('📝', 'Set DATABASE_URL in your environment to enable automatic setup.', colors.dim)
    return
  }

  log('🔍', 'Checking database configuration...', colors.blue)

  let connection: mysql.Connection | null = null

  try {
    // Step 1: Test database connection
    log('🔌', 'Connecting to database...', colors.blue)

    connection = await mysql.createConnection(databaseUrl)

    log('✅', 'Database connection successful!', colors.green)

    // Step 2: Check existing tables
    log('📋', 'Checking existing tables...', colors.blue)

    const [rows] = await connection.query('SHOW TABLES')
    const tables = (rows as Array<Record<string, string>>).map((row) => Object.values(row)[0])

    if (tables.length > 0) {
      // Database has tables - check if it's properly configured
      const missingCoreTables = CORE_TABLES.filter((table) => !tables.includes(table))

      if (missingCoreTables.length === 0) {
        log('✅', `Database is properly configured with ${tables.length} tables.`, colors.green)
        log('📦', `Core tables found: ${CORE_TABLES.join(', ')}`, colors.dim)
        return
      } else if (missingCoreTables.length === CORE_TABLES.length) {
        // All core tables missing - might be a different database or partial setup
        log('⚠️', `Found ${tables.length} tables but missing all core tables.`, colors.yellow)
        log('📝', `Existing tables: ${tables.join(', ')}`, colors.dim)
        log('❌', 'Database may belong to another application. Skipping setup for safety.', colors.red)
        return
      } else {
        // Some core tables exist - partial setup, might need migration
        log('⚠️', `Partial setup detected. Missing tables: ${missingCoreTables.join(', ')}`, colors.yellow)
        log('📝', 'Run "pnpm db:push" or "pnpm db:migrate" to complete setup.', colors.yellow)
        return
      }
    }

    // Step 3: Database is empty - perform initial setup
    log('📭', 'Database is empty. Starting initial setup...', colors.yellow)
    console.log('')

    // Run drizzle-kit push with --force to skip interactive confirmation
    // This is safe because we've already verified the database is empty
    log('🚀', 'Running database schema push (drizzle-kit push --force)...', colors.blue)
    console.log('')

    try {
      execSync('npx drizzle-kit push --force', {
        stdio: 'inherit',
        env: { ...process.env },
        cwd: process.cwd(),
      })
    } catch (pushError) {
      log('❌', 'Failed to push database schema.', colors.red)
      throw pushError
    }

    console.log('')

    // Step 4: Verify setup
    log('🔍', 'Verifying database setup...', colors.blue)

    const [verifyRows] = await connection.query('SHOW TABLES')
    const verifyTables = (verifyRows as Array<Record<string, string>>).map((row) => Object.values(row)[0])

    if (verifyTables.length === 0) {
      log('❌', 'Setup failed - no tables created.', colors.red)
      throw new Error('Database setup verification failed')
    }

    const missingAfterSetup = CORE_TABLES.filter((table) => !verifyTables.includes(table))

    if (missingAfterSetup.length > 0) {
      log('⚠️', `Setup incomplete. Missing: ${missingAfterSetup.join(', ')}`, colors.yellow)
    } else {
      log('✅', `Database setup complete! Created ${verifyTables.length} tables.`, colors.green)
    }

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

    // Don't throw - let the app continue and fail naturally if DB is required
    log('📝', 'You may need to run "pnpm db:push" manually.', colors.dim)
    console.log('')
  } finally {
    if (connection) {
      await connection.end()
    }
  }
}
