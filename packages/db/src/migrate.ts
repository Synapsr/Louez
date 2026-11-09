/**
 * Database Migration Script
 *
 * `pnpm db:migrate:run` runs the pending migrations, `--baseline` marks them
 * all applied (manual recovery). The runner itself is migration-runner.mjs,
 * shared with the app's startup and the Docker migrator image.
 *
 * Usage:
 *   pnpm db:migrate:run     # Run migrations
 *   pnpm start:prod         # Runs migrations then starts the app
 */

import { config } from 'dotenv'

// Load environment variables from .env files (order matters - .env.local takes priority)
config({ path: '.env.local' })
config({ path: '.env' })

import path from 'path'
import { fileURLToPath } from 'url'

import {
  createBaselineOnly as createBaselineIn,
  runMigrations as runMigrationsIn,
} from './migration-runner.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIGRATIONS_FOLDER = path.join(__dirname, 'migrations')

export interface RunMigrationsOptions {
  /**
   * Where to read migration .sql files from. Defaults to the folder next to
   * this file, which only exists when running from the repo (tsx/dev).
   * Bundled environments (Next.js standalone, Docker) must pass an explicit
   * path because __dirname points inside the bundle output.
   */
  migrationsFolder?: string
}

function databaseUrlOrThrow(): string {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL environment variable is not set')
  return databaseUrl
}

export async function runMigrations(options: RunMigrationsOptions = {}) {
  await runMigrationsIn({
    databaseUrl: databaseUrlOrThrow(),
    migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER,
  })
}

// Also export a baseline-only function for manual recovery
export async function createBaselineOnly() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set')
    process.exit(1)
  }
  await createBaselineIn({ databaseUrl, migrationsFolder: MIGRATIONS_FOLDER })
}

// Check if running directly (not imported)
const isMainModule =
  process.argv[1]?.includes('migrate.ts') || process.argv[1]?.includes('migrate.js')

if (isMainModule) {
  // Check for --baseline flag
  if (process.argv.includes('--baseline')) {
    createBaselineOnly()
  } else {
    runMigrations().catch(() => process.exit(1))
  }
}
