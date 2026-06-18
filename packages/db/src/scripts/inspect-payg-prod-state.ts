/**
 * READ-ONLY inspection of a target database's pay-as-you-go / platform-fee migration
 * state. Runs only SELECTs — it never writes, alters, or drops anything.
 *
 * Targets MIGRATE_DATABASE_URL (or argv[2]) ONLY — it does NOT read .env, so it can
 * never accidentally hit the wrong database.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL="mysql://user:pass@host:port/db" \
 *     pnpm --filter @louez/db exec tsx src/scripts/inspect-payg-prod-state.ts
 */
import mysql from 'mysql2/promise'

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL || process.argv[2]
  if (!url) {
    console.error('❌ Provide the target DB via MIGRATE_DATABASE_URL or argv[2].')
    process.exit(1)
  }
  const masked = url.replace(/\/\/([^:]+):[^@]+@/, '//$1:****@')
  console.log('🎯 Target:', masked)

  const conn = await mysql.createConnection(url)
  const q = async (sql: string, params: unknown[] = []) =>
    (await conn.query(sql, params))[0] as Record<string, unknown>[]
  const tableExists = async (name: string) =>
    Number(
      (
        await q(
          `SELECT COUNT(*) n FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [name],
        )
      )[0].n,
    ) > 0
  const colExists = async (table: string, col: string) =>
    Number(
      (
        await q(
          `SELECT COUNT(*) n FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [table, col],
        )
      )[0].n,
    ) > 0
  const count = async (sql: string) => Number((await q(sql))[0].n)

  try {
    const [{ d, v }] = (await q('SELECT DATABASE() d, VERSION() v')) as {
      d: string
      v: string
    }[]
    console.log(`🗄️  database="${d}"  mysql=${v}`)

    const hasMig = await tableExists('__drizzle_migrations')
    console.log(`\n── migration tracking ──`)
    console.log(`__drizzle_migrations: ${hasMig ? 'EXISTS' : 'MISSING'}`)
    if (hasMig) {
      const rows = await q(
        'SELECT hash, created_at FROM `__drizzle_migrations` ORDER BY id',
      )
      console.log(`  recorded migrations: ${rows.length}`)
      const last = rows.slice(-4)
      for (const r of last) {
        const ts = r.created_at ? new Date(Number(r.created_at)).toISOString() : '?'
        console.log(`   • ${String(r.hash).slice(0, 16)}…  ${ts}`)
      }
    }

    console.log(`\n── key tables ──`)
    const hasSubs = await tableExists('subscriptions')
    const hasUsage = await tableExists('pay_as_you_go_usage')
    const hasPlatformFee = await tableExists('platform_fee')
    console.log(`subscriptions:        ${hasSubs ? 'EXISTS' : 'absent'}`)
    console.log(
      `pay_as_you_go_usage:  ${hasUsage ? 'EXISTS' : 'absent (already dropped / never created)'}`,
    )
    console.log(`platform_fee:         ${hasPlatformFee ? 'EXISTS' : 'absent'}`)
    if (hasUsage) {
      const n = await count('SELECT COUNT(*) n FROM `pay_as_you_go_usage`')
      console.log(
        `  ⚠️  pay_as_you_go_usage rows: ${n}  ${n > 0 ? '(DATA PRESENT — drop would lose it)' : '(empty — safe to drop)'}`,
      )
    }
    if (hasPlatformFee) {
      console.log(
        `  platform_fee rows: ${await count('SELECT COUNT(*) n FROM `platform_fee`')}`,
      )
    }

    if (hasSubs) {
      console.log(`\n── subscriptions schema/data ──`)
      console.log(
        `free_reservations_granted column: ${(await colExists('subscriptions', 'free_reservations_granted')) ? 'EXISTS' : 'absent'}`,
      )
      console.log(
        `payment_fee_config column (legacy): ${(await colExists('subscriptions', 'payment_fee_config')) ? 'STILL PRESENT' : 'absent'}`,
      )
      console.log(
        `rows total: ${await count('SELECT COUNT(*) n FROM subscriptions')}`,
      )
      console.log(
        `rows with plan_slug='start': ${await count("SELECT COUNT(*) n FROM subscriptions WHERE plan_slug = 'start'")}`,
      )
    }

    console.log('\n✅ Inspection complete (read-only, nothing was modified).')
  } finally {
    await conn.end()
  }
}

main().catch((e) => {
  console.error('❌ Inspection failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
