import { db, oauthAccessTokens, oauthClientAssertions, oauthRefreshTokens } from "@louez/db";
import { lt, or, sql } from "drizzle-orm";

/**
 * How long an OAuth token row is kept once it expired or was revoked, as the
 * privacy policy promises. A rotated refresh token is revoked: replayed within
 * these days, before its expiry, it still revokes its family; once deleted, it
 * is unknown, `invalid_grant` all the same.
 */
export const OAUTH_TOKEN_GRACE_DAYS = 7;
/**
 * A used client assertion is kept this long past its expiry. Better Auth
 * refuses an expired assertion on the app's clock; the margin covers a
 * database clock ahead of it.
 */
const ASSERTION_GRACE_HOURS = 1;
const PURGE_BATCH = 500;
const PURGE_BUDGET_MS = 5_000;

export interface OAuthPurgeResult {
  refreshTokens: number;
  accessTokens: number;
  clientAssertions: number;
}

/**
 * Deletes, for the cron, on the database's clock: the refresh and access
 * tokens expired or revoked more than `OAUTH_TOKEN_GRACE_DAYS` ago, then the
 * used client assertions past their expiry. Batches until none is left or the
 * time budget is spent; the next run goes on. A valid token is never touched.
 * Deleting a refresh token deletes the access tokens issued with it
 * (`refresh_id`), which expired days before. The dates have no index: each
 * batch scans, and the tables stay small as nothing outlives its grace.
 */
export async function purgeOAuthTokens(
  options: { batch?: number; budgetMs?: number } = {},
): Promise<OAuthPurgeResult> {
  const batch = options.batch ?? PURGE_BATCH;
  const deadline = Date.now() + (options.budgetMs ?? PURGE_BUDGET_MS);
  const tokenCutoff = sql`NOW() - INTERVAL ${sql.raw(String(OAUTH_TOKEN_GRACE_DAYS))} DAY`;
  const assertionCutoff = sql`NOW() - INTERVAL ${sql.raw(String(ASSERTION_GRACE_HOURS))} HOUR`;

  const steps: ReadonlyArray<readonly [keyof OAuthPurgeResult, () => Promise<number>]> = [
    [
      "refreshTokens",
      async () => {
        const [deleted] = await db
          .delete(oauthRefreshTokens)
          .where(
            or(
              lt(oauthRefreshTokens.expiresAt, tokenCutoff),
              lt(oauthRefreshTokens.revoked, tokenCutoff),
            ),
          )
          .limit(batch);
        return deleted.affectedRows;
      },
    ],
    [
      "accessTokens",
      async () => {
        const [deleted] = await db
          .delete(oauthAccessTokens)
          .where(
            or(
              lt(oauthAccessTokens.expiresAt, tokenCutoff),
              lt(oauthAccessTokens.revoked, tokenCutoff),
            ),
          )
          .limit(batch);
        return deleted.affectedRows;
      },
    ],
    [
      "clientAssertions",
      async () => {
        const [deleted] = await db
          .delete(oauthClientAssertions)
          .where(lt(oauthClientAssertions.expiresAt, assertionCutoff))
          .limit(batch);
        return deleted.affectedRows;
      },
    ],
  ];

  const result: OAuthPurgeResult = { refreshTokens: 0, accessTokens: 0, clientAssertions: 0 };
  for (const [key, run] of steps) {
    for (;;) {
      const affected = await run();
      result[key] += affected;
      if (Date.now() >= deadline) return result;
      if (affected < batch) break;
    }
  }
  return result;
}
