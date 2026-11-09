import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// OAuth tokens past their retention, on the database: a refresh or access
// token goes 7 days after it expired or was revoked, never sooner, and a
// valid one stays; a used client assertion goes once expired; the grant they
// reference stays; a run deletes a batch at a time within its time budget.
// Dates are set on the database's clock, which the purge reads.

const CLIENT = "https://client.retention.test/oauth/client.json";

describe(
  "OAuth tokens past their retention (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let retention: typeof import("./oauth-retention");
    let userId: string;
    let grantId: string;

    before(async () => {
      database = await createTestDatabase("auth_oauth_retention");
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      retention = await import("./oauth-retention");

      const [user] = await louezDb.db
        .insert(louezDb.users)
        .values({ email: "owner@retention.test", name: "O" })
        .$returningId();
      userId = user.id;
      await louezDb.db.insert(louezDb.oauthClients).values({
        clientId: CLIENT,
        redirectUris: JSON.stringify(["https://client.retention.test/callback"]),
      });
      const [grant] = await louezDb.db
        .insert(louezDb.apiAgentGrants)
        .values({ userId, clientId: CLIENT, preset: "write", bundles: ["daily"] })
        .$returningId();
      grantId = grant.id;
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      await louezDb.db.delete(louezDb.oauthAccessTokens);
      await louezDb.db.delete(louezDb.oauthRefreshTokens);
      await louezDb.db.delete(louezDb.oauthClientAssertions);
    });

    /** A date on the database's clock, `hours` from now (negative: in the past). */
    const at = (hours: number) => orm.sql`NOW() + INTERVAL ${Math.round(hours * 60)} MINUTE`;
    const DAY = 24;

    const refreshToken = async (
      token: string,
      dates: { expiresIn: number; revokedAgo?: number },
    ) => {
      const [row] = await louezDb.db
        .insert(louezDb.oauthRefreshTokens)
        .values({
          token,
          clientId: CLIENT,
          userId,
          referenceId: grantId,
          scopes: "openid offline_access",
          createdAt: at(dates.expiresIn - 30 * DAY),
          expiresAt: at(dates.expiresIn),
          revoked: dates.revokedAgo === undefined ? null : at(-dates.revokedAgo),
        })
        .$returningId();
      return row.id;
    };

    const accessToken = (
      token: string,
      dates: { expiresIn: number; revokedAgo?: number; refreshId?: string },
    ) =>
      louezDb.db.insert(louezDb.oauthAccessTokens).values({
        token,
        clientId: CLIENT,
        userId,
        referenceId: grantId,
        refreshId: dates.refreshId,
        scopes: "openid",
        createdAt: at(dates.expiresIn - 1),
        expiresAt: at(dates.expiresIn),
        revoked: dates.revokedAgo === undefined ? null : at(-dates.revokedAgo),
      });

    const refreshTokens = async () =>
      (
        await louezDb.db
          .select({ token: louezDb.oauthRefreshTokens.token })
          .from(louezDb.oauthRefreshTokens)
      )
        .map((row) => row.token)
        .sort();
    const accessTokens = async () =>
      (
        await louezDb.db
          .select({ token: louezDb.oauthAccessTokens.token })
          .from(louezDb.oauthAccessTokens)
      )
        .map((row) => row.token)
        .sort();
    const assertions = async () =>
      (
        await louezDb.db
          .select({ id: louezDb.oauthClientAssertions.id })
          .from(louezDb.oauthClientAssertions)
      )
        .map((row) => row.id)
        .sort();

    test("tokens go 7 days after they expired or were revoked; valid and recent ones stay", async () => {
      await refreshToken("r_valid", { expiresIn: 20 * DAY });
      await refreshToken("r_revoked_6d", { expiresIn: 20 * DAY, revokedAgo: 6 * DAY });
      const rotatedOld = await refreshToken("r_revoked_8d", {
        expiresIn: 20 * DAY,
        revokedAgo: 8 * DAY,
      });
      await refreshToken("r_expired_6d", { expiresIn: -6 * DAY });
      await refreshToken("r_expired_8d", { expiresIn: -8 * DAY });

      await accessToken("a_valid", { expiresIn: 1 });
      await accessToken("a_expired_6d", { expiresIn: -6 * DAY });
      await accessToken("a_expired_8d", { expiresIn: -8 * DAY });
      await accessToken("a_revoked_8d", { expiresIn: 1, revokedAgo: 8 * DAY });
      // Issued with the refresh token revoked 8 days ago, expired since.
      await accessToken("a_of_rotated", { expiresIn: -8 * DAY - 1, refreshId: rotatedOld });

      assert.deepEqual(await retention.purgeOAuthTokens(), {
        refreshTokens: 2,
        // The one issued with a deleted refresh token went with it.
        accessTokens: 2,
        clientAssertions: 0,
      });
      assert.deepEqual(await refreshTokens(), ["r_expired_6d", "r_revoked_6d", "r_valid"]);
      assert.deepEqual(await accessTokens(), ["a_expired_6d", "a_valid"]);

      const [grant] = await louezDb.db
        .select({ id: louezDb.apiAgentGrants.id })
        .from(louezDb.apiAgentGrants)
        .where(orm.eq(louezDb.apiAgentGrants.id, grantId));
      assert.ok(grant, "the grant stays");
    });

    test("a used client assertion goes once expired, past an hour's margin", async () => {
      await louezDb.db.insert(louezDb.oauthClientAssertions).values([
        { id: "jti_live", expiresAt: at(0.1) },
        { id: "jti_expired_30m", expiresAt: at(-0.5) },
        { id: "jti_expired_2h", expiresAt: at(-2) },
      ]);
      const result = await retention.purgeOAuthTokens();
      assert.equal(result.clientAssertions, 1);
      assert.deepEqual(await assertions(), ["jti_expired_30m", "jti_live"]);
    });

    test("a batch at a time within the time budget; the next run goes on", async () => {
      for (let index = 0; index < 5; index += 1) {
        await refreshToken(`r_old_${index}`, { expiresIn: -10 * DAY });
      }
      await accessToken("a_old", { expiresIn: -10 * DAY });
      await refreshToken("r_valid", { expiresIn: 20 * DAY });

      // Batches of two, with no time left after the first.
      assert.deepEqual(await retention.purgeOAuthTokens({ batch: 2, budgetMs: 0 }), {
        refreshTokens: 2,
        accessTokens: 0,
        clientAssertions: 0,
      });
      assert.equal((await refreshTokens()).length, 4);
      assert.deepEqual(await accessTokens(), ["a_old"]);

      assert.deepEqual(await retention.purgeOAuthTokens({ batch: 2 }), {
        refreshTokens: 3,
        accessTokens: 1,
        clientAssertions: 0,
      });
      assert.deepEqual(await refreshTokens(), ["r_valid"]);
      assert.deepEqual(await accessTokens(), []);
    });
  },
);
