// TEMP: reset corrupted/stale pay_as_you_go_config to NULL so stores follow the live
// platform default (PAYG_DEFAULT_PRICING). Safe: no intentional per-store overrides exist.
import mysql from 'mysql2/promise'
const conn = await mysql.createConnection(process.env.MIGRATE_DATABASE_URL!)
const [[d]] = (await conn.query('SELECT DATABASE() d')) as any
console.log(`DB: ${d.d}`)
const [[before]] = (await conn.query(
  `SELECT COUNT(*) n FROM subscriptions WHERE pay_as_you_go_config IS NOT NULL`,
)) as any
console.log(`stored configs (to reset to NULL): ${before.n}`)
const [res] = (await conn.query(
  `UPDATE subscriptions SET pay_as_you_go_config = NULL, updated_at = now()
   WHERE pay_as_you_go_config IS NOT NULL`,
)) as any
console.log(`✅ rows reset: ${res.affectedRows}`)
const [[after]] = (await conn.query(
  `SELECT COUNT(*) n FROM subscriptions WHERE pay_as_you_go_config IS NOT NULL`,
)) as any
console.log(`remaining non-null configs: ${after.n}`)
await conn.end()
