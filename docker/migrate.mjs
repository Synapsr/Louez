/**
 * Database migrations for the Docker migrator image (`node docker/migrate.mjs`).
 *
 * Environment variables only (no .env file): DATABASE_URL, and MIGRATIONS_FOLDER
 * (default ./migrations, from WORKDIR /app). Exits 1 when the variable is
 * missing or a migration fails, 0 once the database is up to date.
 *
 * It runs packages/db/src/migration-runner.mjs, the runner the app uses at
 * startup and `pnpm db:migrate:run` uses: a migration is applied when its SQL's
 * hash is recorded, so this image and the app agree on what is pending.
 */

import { runMigrations } from '../packages/db/src/migration-runner.mjs'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('❌ DATABASE_URL environment variable is not set')
  process.exit(1)
}

try {
  await runMigrations({
    databaseUrl,
    migrationsFolder: process.env.MIGRATIONS_FOLDER || './migrations',
  })
} catch (error) {
  // The runner logged what failed.
  if (error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED') {
    console.error('   Make sure the database is running and DATABASE_URL is correct')
  }
  process.exit(1)
}
