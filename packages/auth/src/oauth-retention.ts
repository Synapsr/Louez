import { db, oauthAccessTokens, oauthClientAssertions, oauthRefreshTokens } from "@louez/db";
import { and, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { MySqlColumn, MySqlTable } from "drizzle-orm/mysql-core";

/**
 * How long, at most, an OAuth token row is kept once it expired or was
 * revoked, as the privacy policy promises. A rotated refresh token is revoked:
 * replayed within these days, before its expiry, it still revokes its family;
 * once deleted, it is unknown, `invalid_grant` all the same.
 */
export const OAUTH_TOKEN_GRACE_DAYS = 7;
/**
 * The purge deletes a day before the promise runs out, so a backlog or a cron
 * outage of up to a day still keeps it.
 */
const OAUTH_TOKEN_PURGE_AFTER_DAYS = OAUTH_TOKEN_GRACE_DAYS - 1;
/**
 * A used client assertion is kept this long past its expiry. Better Auth
 * refuses an expired assertion on the app's clock; the margin covers a
 * database clock ahead of it.
 */
const ASSERTION_GRACE_HOURS = 1;
const PURGE_BATCH = 500;
/** Each table's own share of a run, so a backlog in one never starves another. */
const PURGE_BUDGET_MS_PER_TABLE = 2_000;

export interface OAuthPurgeResult {
  refreshTokens: number;
  accessTokens: number;
  clientAssertions: number;
}

/**
 * One batch of a table: the ids of rows past `due`, read without locking (a
 * plain consistent read: the scan never blocks sign-ins or rotations), then
 * deleted by primary key with the condition checked again, so a row that
 * changed in between stays.
 */
async function purgeBatch(
  table: MySqlTable,
  idColumn: MySqlColumn,
  due: SQL,
  batch: number,
): Promise<{ found: number; deleted: number }> {
  const rows = await db.select({ id: idColumn }).from(table).where(due).limit(batch);
  if (rows.length === 0) return { found: 0, deleted: 0 };
  const ids = rows.map((row) => String(row.id));
  const [deleted] = await db.delete(table).where(and(inArray(idColumn, ids), due));
  return { found: rows.length, deleted: deleted.affectedRows };
}

/**
 * Deletes, for the cron, on the database's clock: the refresh and access
 * tokens expired or revoked more than `OAUTH_TOKEN_PURGE_AFTER_DAYS` ago (a
 * day inside the promised `OAUTH_TOKEN_GRACE_DAYS`), and the used client
 * assertions past their expiry. Each table batches within its own share of
 * the run; the next run goes on. A valid token is never touched. Deleting a
 * refresh token deletes the access tokens issued with it (`refresh_id`),
 * which expired days before. The dates have no index: the reads scan, without
 * locks, and the tables stay small as nothing outlives its grace. Two runs at
 * once only race to delete the same ids.
 */
export async function purgeOAuthTokens(
  options: { batch?: number; budgetMsPerTable?: number } = {},
): Promise<OAuthPurgeResult> {
  const batch = options.batch ?? PURGE_BATCH;
  const budget = options.budgetMsPerTable ?? PURGE_BUDGET_MS_PER_TABLE;
  const tokenCutoff = sql`NOW() - INTERVAL ${sql.raw(String(OAUTH_TOKEN_PURGE_AFTER_DAYS))} DAY`;
  const assertionCutoff = sql`NOW() - INTERVAL ${sql.raw(String(ASSERTION_GRACE_HOURS))} HOUR`;

  const tables: ReadonlyArray<readonly [keyof OAuthPurgeResult, MySqlTable, MySqlColumn, SQL]> = [
    [
      "refreshTokens",
      oauthRefreshTokens,
      oauthRefreshTokens.id,
      or(
        lt(oauthRefreshTokens.expiresAt, tokenCutoff),
        lt(oauthRefreshTokens.revoked, tokenCutoff),
      )!,
    ],
    [
      "accessTokens",
      oauthAccessTokens,
      oauthAccessTokens.id,
      or(lt(oauthAccessTokens.expiresAt, tokenCutoff), lt(oauthAccessTokens.revoked, tokenCutoff))!,
    ],
    [
      "clientAssertions",
      oauthClientAssertions,
      oauthClientAssertions.id,
      lt(oauthClientAssertions.expiresAt, assertionCutoff),
    ],
  ];

  const result: OAuthPurgeResult = { refreshTokens: 0, accessTokens: 0, clientAssertions: 0 };
  for (const [key, table, idColumn, due] of tables) {
    const deadline = Date.now() + budget;
    for (;;) {
      const { found, deleted } = await purgeBatch(table, idColumn, due, batch);
      result[key] += deleted;
      if (found < batch || Date.now() >= deadline) break;
    }
  }
  return result;
}
