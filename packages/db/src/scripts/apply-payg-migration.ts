/**
 * Safely apply ONLY migration 0042 (pay-as-you-go) to a target database.
 *
 * Targets the URL given via MIGRATE_DATABASE_URL (or argv[2]) ONLY — it does NOT
 * read .env / .env.local, so it can never accidentally hit the wrong database.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL="mysql://user:pass@host:port/db" \
 *     pnpm --filter @louez/db exec tsx src/scripts/apply-payg-migration.ts
 *
 * All statements are additive (2 tables, 2 defaulted columns, 5 indexes) and applied
 * idempotently (re-running is safe).
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
  '0042_supreme_scarlet_witch.sql',
)

const IDEMPOTENT_CODES = new Set([
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_FIELDNAME',
  'ER_DUP_KEYNAME',
])

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
    .map((s) => s.trim())
    .filter(Boolean)
  console.log(`📄 0042 has ${statements.length} statement(s)`)

  const conn = await mysql.createConnection(url)
  try {
    const [[dbRow]] = (await conn.query(
      'SELECT DATABASE() d, VERSION() v',
    )) as any
    console.log(`🗄️  Connected to database "${dbRow.d}" (MySQL ${dbRow.v})`)

    // Sanity: must be the Louez schema.
    const [[subs]] = (await conn.query(
      `SELECT COUNT(*) n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions'`,
    )) as any
    if (subs.n === 0) {
      throw new Error('Aborting: no "subscriptions" table — wrong database?')
    }

    let applied = 0
    let skipped = 0
    for (const sql of statements) {
      const head = sql.split('\n')[0].slice(0, 80)
      try {
        await conn.query(sql)
        applied++
        console.log(`   ✅ ${head}`)
      } catch (error) {
        const err = error as { code?: string; sqlMessage?: string }
        if (err.code && IDEMPOTENT_CODES.has(err.code)) {
          skipped++
          console.log(`   ⚠️  already exists, skipped: ${head}`)
        } else {
          console.error(`   ❌ FAILED: ${head}`)
          throw error
        }
      }
    }
    console.log(`📊 applied: ${applied}, skipped (already existed): ${skipped}`)

    // Verify.
    const [tbls] = (await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('pay_as_you_go_usage','pay_as_you_go_invoices')`,
    )) as any
    const [cols] = (await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME IN ('billing_mode','pay_as_you_go_config')`,
    )) as any
    const ok = tbls.length === 2 && cols.length === 2
    console.log(`\n🔎 Verify: tables=${tbls.length}/2, columns=${cols.length}/2`)
    console.log(ok ? '✅ Migration 0042 applied & verified.' : '❌ INCOMPLETE!')
    if (!ok) process.exitCode = 1
  } finally {
    await conn.end()
  }
}

main().catch((e) => {
  console.error('❌ Apply failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
