/**
 * Safely apply ONLY migration 0043 (pay-as-you-go platform-fee ledger, free-reservation
 * allowance, and the start→pay-as-you-go plan migration) to a target database.
 *
 * Targets the URL given via MIGRATE_DATABASE_URL (or argv[2]) ONLY — it does NOT read
 * .env / .env.local, so it can never accidentally hit the wrong database.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL="mysql://user:pass@host:port/db" \
 *     pnpm --filter @louez/db exec tsx src/scripts/apply-payg-platform-fee-migration.ts
 *
 * Idempotent: re-running skips an existing table/column/index and an already-dropped one.
 * GUARDED: aborts (without dropping) if the legacy `pay_as_you_go_usage` table still has
 * rows, so no data is silently lost.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATION_FILE = path.join(
  __dirname,
  '..',
  'migrations',
  '0043_payg_platform_fee.sql',
)

const IDEMPOTENT_CODES = new Set([
  'ER_TABLE_EXISTS_ERROR', // CREATE TABLE that already exists
  'ER_DUP_FIELDNAME', // ADD column that already exists
  'ER_DUP_KEYNAME', // CREATE INDEX that already exists
  'ER_BAD_TABLE_ERROR', // DROP TABLE that no longer exists
])

function isDropUsage(sql: string): boolean {
  return /drop\s+table\s+(if\s+exists\s+)?`?pay_as_you_go_usage`?/i.test(sql)
}

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL || process.argv[2]
  if (!url) {
    console.error(
      '❌ Provide the target DB via MIGRATE_DATABASE_URL env var or argv[2].',
    )
    process.exit(1)
  }

  const masked = url.replace(/\/\/([^:]+):[^@]+@/, '//$1:****@')
  console.log('🎯 Target:', masked)

  const raw = fs.readFileSync(MIGRATION_FILE, 'utf8')
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean)
  console.log(`📄 0043 has ${statements.length} statement(s)`)

  const conn = await mysql.createConnection(url)
  try {
    const [[dbRow]] = (await conn.query(
      'SELECT DATABASE() d, VERSION() v',
    )) as any
    console.log(`🗄️  Connected to database "${dbRow.d}" (MySQL ${dbRow.v})`)

    const [[subs]] = (await conn.query(
      `SELECT COUNT(*) n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions'`,
    )) as any
    if (subs.n === 0) {
      throw new Error('Aborting: no "subscriptions" table — wrong database?')
    }

    // Guard: never drop the legacy usage table if it still holds data.
    const [[usageTable]] = (await conn.query(
      `SELECT COUNT(*) n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pay_as_you_go_usage'`,
    )) as any
    if (usageTable.n > 0) {
      const [[usageRows]] = (await conn.query(
        'SELECT COUNT(*) n FROM `pay_as_you_go_usage`',
      )) as any
      if (usageRows.n > 0) {
        throw new Error(
          `Aborting: pay_as_you_go_usage has ${usageRows.n} row(s). ` +
            'Migrate/back up that data before applying 0043 (it drops the table).',
        )
      }
    }

    let applied = 0
    let skipped = 0
    for (const sql of statements) {
      const head = sql.split('\n')[0].slice(0, 80)
      if (isDropUsage(sql) && usageTable.n === 0) {
        skipped++
        console.log(`   ⚠️  pay_as_you_go_usage already gone, skipped: ${head}`)
        continue
      }
      try {
        await conn.query(sql)
        applied++
        console.log(`   ✅ ${head}`)
      } catch (error) {
        const err = error as { code?: string }
        if (err.code && IDEMPOTENT_CODES.has(err.code)) {
          skipped++
          console.log(`   ⚠️  already applied, skipped: ${head}`)
        } else {
          console.error(`   ❌ FAILED: ${head}`)
          throw error
        }
      }
    }
    console.log(`📊 applied: ${applied}, skipped: ${skipped}`)

    // Verify.
    const [tbl] = (await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_fee'`,
    )) as any
    const [cols] = (await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'free_reservations_granted'`,
    )) as any
    const [[remainingStart]] = (await conn.query(
      `SELECT COUNT(*) n FROM subscriptions WHERE plan_slug = 'start'`,
    )) as any
    const ok =
      tbl.length === 1 && cols.length === 1 && remainingStart.n === 0
    console.log(
      `\n🔎 Verify: platform_fee=${tbl.length}/1, free_reservations_granted=${cols.length}/1, ` +
        `remaining 'start' rows=${remainingStart.n}`,
    )
    console.log(ok ? '✅ Migration 0043 applied & verified.' : '❌ INCOMPLETE!')
    if (!ok) process.exitCode = 1
  } finally {
    await conn.end()
  }
}

main().catch((e) => {
  console.error('❌ Apply failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
