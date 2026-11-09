import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import {
  AUTH_DISABLED_PATHS,
  answerOAuthConsent,
  mcpOAuthEndpoints,
  type createAccessTokenVerifier,
} from "./oauth";

// A token lineage stays bound to the grant it started under, on MySQL with
// Better Auth's drizzle adapter and the app's tables: revoke, reconnect the
// same client, and nothing from the first connection (an unused code, a
// rotation racing the revoke, a replayed refresh token) acts for, or touches,
// the second one. Revoking here is what `revokeGrant` does: delete the grant.

const ORIGIN = "https://app.example.com";
const endpoints = mcpOAuthEndpoints(ORIGIN)!;
const REDIRECT_URI = "https://client.example.org/callback";
const SECRET = "oauth-db-test-secret-never-used-in-production-1234567890";

/** Better Auth as the app configures it for OAuth, on the test database. */
async function buildAuth(db: typeof import("@louez/db").db) {
  const { betterAuth } = await import("better-auth");
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  const { nanoid } = await import("nanoid");
  const { mcpOAuthPlugins } = await import("./oauth");
  const { currentGrantId, isGrantActive } = await import("./grant-lineage");
  const { authTables } = await import("./tables");
  return betterAuth({
    baseURL: ORIGIN,
    basePath: "/api/auth",
    secret: SECRET,
    trustedOrigins: [ORIGIN],
    database: drizzleAdapter(db, { provider: "mysql", schema: authTables }),
    advanced: { database: { generateId: () => nanoid() } },
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    logger: { disabled: true },
    disabledPaths: AUTH_DISABLED_PATHS,
    plugins: mcpOAuthPlugins(endpoints, { currentGrantId, isGrantActive }),
  });
}

describe(
  "token lineages bound to their grant (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let auth: Awaited<ReturnType<typeof buildAuth>>;
    let verify: ReturnType<typeof createAccessTokenVerifier>;
    let clientId: string;
    let userId: string;
    const jar = new Map<string, string>();

    const request = async (
      path: string,
      init: RequestInit & { form?: Record<string, string>; anonymous?: boolean } = {},
    ) => {
      const headers = new Headers(init.headers);
      headers.set("origin", ORIGIN);
      if (jar.size && !init.anonymous) {
        headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "));
      }
      let body = init.body;
      if (init.form) {
        headers.set("content-type", "application/x-www-form-urlencoded");
        body = new URLSearchParams(init.form).toString();
      } else if (body) {
        headers.set("content-type", "application/json");
      }
      const response = await auth.handler(
        new Request(`${ORIGIN}${path}`, { ...init, headers, body, redirect: "manual" }),
      );
      for (const setCookie of response.headers.getSetCookie()) {
        const [nameValue] = setCookie.split(";");
        const separator = nameValue.indexOf("=");
        jar.set(nameValue.slice(0, separator), nameValue.slice(separator + 1));
      }
      return response;
    };

    before(async () => {
      database = await createTestDatabase("auth_oauth_lineage");
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      const { createAccessTokenVerifier } = await import("./oauth");
      auth = await buildAuth(louezDb.db);
      verify = createAccessTokenVerifier({
        issuer: endpoints.issuer,
        audience: endpoints.resource,
        loadJwks: () => auth.api.getJwks(),
      });

      const signUp = await request("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({
          email: "owner@lineage.test",
          password: "Test-only-1234!",
          name: "O",
        }),
      });
      assert.equal(signUp.status, 200, await signUp.text());
      const [user] = await louezDb.db.select({ id: louezDb.users.id }).from(louezDb.users);
      userId = user.id;

      const registered = await request("/api/auth/oauth2/register", {
        method: "POST",
        anonymous: true,
        body: JSON.stringify({
          client_name: "Claude",
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      });
      assert.equal(registered.status, 201, await registered.clone().text());
      clientId = ((await registered.json()) as { client_id: string }).client_id;
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    // --- The connection, as the consent page and the client run it -------------

    /** What saving the consent does: the grant first. */
    const connect = async () => {
      const [grant] = await louezDb.db
        .insert(louezDb.apiAgentGrants)
        .values({ userId, clientId, preset: "write", bundles: ["daily"] })
        .$returningId();
      return grant.id;
    };

    /** What revoking does: the grant goes, and with it everything referencing it. */
    const revoke = (grantId: string) =>
      louezDb.db.delete(louezDb.apiAgentGrants).where(orm.eq(louezDb.apiAgentGrants.id, grantId));

    /** Authorizes and consents: the code, not exchanged yet. */
    const code = async () => {
      const verifier = randomBytes(32).toString("base64url");
      const redirect = await request(
        `/api/auth/oauth2/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          scope: "openid offline_access",
          state: "s",
          code_challenge: createHash("sha256").update(verifier).digest("base64url"),
          code_challenge_method: "S256",
          resource: endpoints.resource,
        })}`,
      );
      const location = new URL(redirect.headers.get("location")!, ORIGIN);
      let back: URL;
      if (location.pathname === "/oauth/consent") {
        back = new URL(
          await answerOAuthConsent(auth, endpoints, {
            oauthQuery: location.search.slice(1),
            accept: true,
            headers: new Headers({
              cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
            }),
          }),
        );
      } else {
        back = location;
      }
      const issued = back.searchParams.get("code");
      assert.ok(issued, `no code: ${back}`);
      return { code: issued, verifier };
    };

    const token = (form: Record<string, string>) =>
      request("/api/auth/oauth2/token", {
        method: "POST",
        anonymous: true,
        form: { client_id: clientId, resource: endpoints.resource, ...form },
      });

    const exchange = (issued: { code: string; verifier: string }) =>
      token({
        grant_type: "authorization_code",
        code: issued.code,
        redirect_uri: REDIRECT_URI,
        code_verifier: issued.verifier,
      });

    const refresh = (refreshToken: string) =>
      token({ grant_type: "refresh_token", refresh_token: refreshToken });

    type Tokens = { access_token: string; refresh_token: string };
    const ok = async (response: Response): Promise<Tokens> => {
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()) as Tokens;
    };
    const refused = async (response: Response) => {
      assert.notEqual(response.status, 200, "issued");
      if (response.status === 400) {
        assert.equal(((await response.json()) as { error?: string }).error, "invalid_grant");
      }
    };

    const lineageRows = async (grantId: string) =>
      louezDb.db
        .select({ id: louezDb.oauthRefreshTokens.id })
        .from(louezDb.oauthRefreshTokens)
        .where(orm.eq(louezDb.oauthRefreshTokens.referenceId, grantId));

    const fresh = async () => {
      // Each case starts from no connection.
      await louezDb.db.delete(louezDb.apiAgentGrants);
      const grantId = await connect();
      const tokens = await ok(await exchange(await code()));
      return { grantId, tokens };
    };

    // --- Cases ------------------------------------------------------------------

    test("a lineage names the grant it started under, through every refresh", async () => {
      const { grantId, tokens } = await fresh();
      assert.equal((await verify(tokens.access_token))?.grantId, grantId);
      const refreshed = await ok(await refresh(tokens.refresh_token));
      assert.equal((await verify(refreshed.access_token))?.grantId, grantId);
      assert.ok((await lineageRows(grantId)).length >= 1, "its refresh tokens reference the grant");
    });

    test("(b) a code issued under the old grant is refused after revoke and reconnect", async () => {
      const { grantId: first } = await fresh();
      const pending = await code();
      await revoke(first);
      const second = await connect();

      await refused(await exchange(pending));
      assert.equal((await lineageRows(first)).length, 0);

      // The new connection works, under its own grant.
      const tokens = await ok(await exchange(await code()));
      assert.equal((await verify(tokens.access_token))?.grantId, second);
    });

    test("(a) a rotation that completed before the revoke is refused after reconnect", async () => {
      const { grantId: first, tokens } = await fresh();
      const rotated = await ok(await refresh(tokens.refresh_token));
      await revoke(first);
      assert.equal((await lineageRows(first)).length, 0, "the revoke took the whole lineage");
      const second = await connect();

      await refused(await refresh(rotated.refresh_token));
      const tokensB = await ok(await exchange(await code()));
      assert.equal((await verify(tokensB.access_token))?.grantId, second);
    });

    test("(a) a rotation racing the revoke cannot insert its new row for the gone grant", async () => {
      const { grantId: first, tokens } = await fresh();

      // Codex's order: the rotation has marked the presented token, the revoke
      // runs, then the rotation inserts the new refresh row.
      const context = await auth.$context;
      const create = context.adapter.create.bind(context.adapter);
      let raced = false;
      context.adapter.create = (async (args: { model: string }) => {
        if (args.model === "oauthRefreshToken" && !raced) {
          raced = true;
          await revoke(first);
        }
        return create(args as never);
      }) as typeof context.adapter.create;
      try {
        await refused(await refresh(tokens.refresh_token));
      } finally {
        context.adapter.create = create;
      }
      assert.ok(raced, "the revoke ran inside the rotation");
      assert.equal((await lineageRows(first)).length, 0, "no row of the gone grant was inserted");

      const second = await connect();
      const tokensB = await ok(await exchange(await code()));
      assert.equal((await verify(tokensB.access_token))?.grantId, second);
      await refused(await refresh(tokens.refresh_token));
      await ok(await refresh(tokensB.refresh_token));
    });

    test("(c) replaying an old revoked refresh token never touches the new grant's tokens", async () => {
      const { grantId: first, tokens } = await fresh();
      // Rotate once: the first refresh token is now a revoked member of the family.
      await ok(await refresh(tokens.refresh_token));
      await revoke(first);
      const second = await connect();
      const tokensB = await ok(await exchange(await code()));
      const before = (await lineageRows(second)).length;
      assert.ok(before >= 1);

      // A replay of a rotated token would have the provider tear down the
      // (user, client) family. The old one no longer exists: nothing happens.
      await refused(await refresh(tokens.refresh_token));
      assert.equal((await lineageRows(second)).length, before, "the new grant's tokens are intact");
      const refreshedB = await ok(await refresh(tokensB.refresh_token));
      assert.equal((await verify(refreshedB.access_token))?.grantId, second);
    });

    test("the purge keeps a rotated refresh token 7 days: a replay still revokes its family", async () => {
      const { purgeOAuthTokens } = await import("./oauth-retention");
      const spentRows = () =>
        louezDb.db
          .select({ id: louezDb.oauthRefreshTokens.id })
          .from(louezDb.oauthRefreshTokens)
          .where(orm.isNotNull(louezDb.oauthRefreshTokens.rotatedAt));
      const pastReuseWindow = () =>
        louezDb.db
          .update(louezDb.oauthRefreshTokens)
          .set({ rotationReplayExpiresAt: orm.sql`NOW() - INTERVAL 1 MINUTE` })
          .where(orm.isNotNull(louezDb.oauthRefreshTokens.rotatedAt));

      // Within 7 days: the spent token stays, the live one still refreshes, and
      // a replay past the provider's reuse window revokes the family.
      const { tokens } = await fresh();
      const rotated = await ok(await refresh(tokens.refresh_token));
      await pastReuseWindow();
      assert.equal((await purgeOAuthTokens()).refreshTokens, 0);
      assert.equal((await spentRows()).length, 1, "the spent token stays");
      const live = await ok(await refresh(rotated.refresh_token));
      await pastReuseWindow();
      await refused(await refresh(tokens.refresh_token));
      await refused(await refresh(live.refresh_token));

      // Revoked more than 7 days ago, the spent row goes; a replay is then an
      // unknown token, refused, and the live one keeps working.
      const second = await fresh();
      const rotatedB = await ok(await refresh(second.tokens.refresh_token));
      await louezDb.db
        .update(louezDb.oauthRefreshTokens)
        .set({ revoked: orm.sql`NOW() - INTERVAL 8 DAY` })
        .where(orm.isNotNull(louezDb.oauthRefreshTokens.rotatedAt));
      assert.equal((await purgeOAuthTokens()).refreshTokens, 1);
      assert.deepEqual(await spentRows(), []);
      await refused(await refresh(second.tokens.refresh_token));
      await ok(await refresh(rotatedB.refresh_token));
    });

    test("a session cannot delete or rewrite a consent, nor delete a client, behind Louez's grant", async () => {
      // One grant per user and client: start from none.
      await louezDb.db
        .delete(louezDb.apiAgentGrants)
        .where(orm.eq(louezDb.apiAgentGrants.userId, userId));
      const grantId = await connect();
      try {
        await code();
        const [consent] = await louezDb.db
          .select({ id: louezDb.oauthConsents.id })
          .from(louezDb.oauthConsents)
          .where(orm.eq(louezDb.oauthConsents.referenceId, grantId));
        assert.ok(consent, "the consent exists");

        for (const [path, body] of [
          ["/api/auth/oauth2/delete-consent", { id: consent.id }],
          ["/api/auth/oauth2/update-consent", { id: consent.id, update: { scopes: ["openid"] } }],
        ] as const) {
          const response = await request(path, { method: "POST", body: JSON.stringify(body) });
          assert.equal(response.status, 404, path);
        }
        for (const path of [
          "/api/auth/oauth2/get-consents",
          `/api/auth/oauth2/get-consent?id=${consent.id}`,
        ]) {
          assert.equal((await request(path)).status, 404, path);
        }
        const deleteClient = await request("/api/auth/oauth2/delete-client", {
          method: "POST",
          body: JSON.stringify({ client_id: clientId }),
        });
        assert.ok([401, 403].includes(deleteClient.status), String(deleteClient.status));

        // The grant, its consent and its client are all still there.
        const grants = await louezDb.db
          .select({ id: louezDb.apiAgentGrants.id })
          .from(louezDb.apiAgentGrants)
          .where(orm.eq(louezDb.apiAgentGrants.id, grantId));
        assert.equal(grants.length, 1);
        const consents = await louezDb.db
          .select({ id: louezDb.oauthConsents.id })
          .from(louezDb.oauthConsents)
          .where(orm.eq(louezDb.oauthConsents.id, consent.id));
        assert.equal(consents.length, 1);
      } finally {
        await revoke(grantId);
      }
    });
  },
);
