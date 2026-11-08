import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { createMemoryStorage } from "./memory-storage";
import { createTestUrls } from "./test-urls";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// Agent connections over OAuth, end to end through `call()`, on the database.
// Better Auth stays out: a session is read from a test header, access tokens
// are signed with a test key and checked by the real verifier, and the
// consent's signed query is "signed" when it says `sig=ok`.

const ISSUER = "https://app.louez.test/api/auth";
const RESOURCE = "https://app.louez.test/api/mcp";
const SESSION_HEADER = "x-test-session-user";

let tokens: Awaited<ReturnType<typeof createTestAccessTokens>>;
// On globalThis: the mocked module may close over another instance of this file.
const answers = globalThis as {
  louezConsentAnswers?: Array<{ oauthQuery: string; accept: boolean }>;
};
answers.louezConsentAnswers ??= [];
const consentAnswers = answers.louezConsentAnswers;

mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@oa.test` } } : null;
        },
      },
    },
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
    readConsentRequest: async (oauthQuery: string) => {
      const params = new URLSearchParams(oauthQuery);
      const clientId = params.get("client_id");
      return params.get("sig") === "ok" && clientId
        ? { clientId, redirectUri: params.get("redirect_uri"), scopes: ["openid"] }
        : null;
    },
    answerConsent: async (input: { oauthQuery: string; accept: boolean }) => {
      consentAnswers.push({ oauthQuery: input.oauthQuery, accept: input.accept });
      return input.accept
        ? "https://client.oa.test/callback?code=the-code"
        : "https://client.oa.test/callback?error=access_denied";
    },
  },
});

const OWNER = "oa_owner_user_000001";
const MEMBER = "oa_member_user_00001";
const STORE_A = "oa_store_a_000000001";
const STORE_B = "oa_store_b_000000001";
const STORE_LATER = "oa_store_c_000000001";
const CLIENT = "https://claude.oa.test/oauth/client.json";
const OTHER_CLIENT = "dcr-registered-client";

describe("agent connections over OAuth (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let grants: typeof import("../services/agent-grants");
  let icons: typeof import("../services/agent-client-icons");
  let connections: typeof import("../routers/dashboard/agent-connections").dashboardAgentConnectionsRouter;
  let stores: typeof import("../routers/dashboard/stores").dashboardStoresRouter;
  let fixture: ReturnType<typeof import("./testing").createFixtureRouter>;

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
  };

  before(async () => {
    tokens = await createTestAccessTokens({ issuer: ISSUER, audience: RESOURCE });
    database = await createTestDatabase("api_oauth");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    grants = await import("../services/agent-grants");
    icons = await import("../services/agent-client-icons");
    ({ dashboardAgentConnectionsRouter: connections } =
      await import("../routers/dashboard/agent-connections"));
    ({ dashboardStoresRouter: stores } = await import("../routers/dashboard/stores"));
    fixture = (await import("./testing")).createFixtureRouter();

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@oa.test" },
      { id: MEMBER, email: "member@oa.test" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE_A, userId: OWNER, name: "A store", slug: "oa-store-a" },
      { id: STORE_B, userId: OWNER, name: "B store", slug: "oa-store-b" },
      { id: STORE_LATER, userId: MEMBER, name: "C store", slug: "oa-store-c" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE_A, userId: OWNER, role: "owner" },
      { storeId: STORE_B, userId: OWNER, role: "owner" },
      { storeId: STORE_A, userId: MEMBER, role: "member" },
    ]);
    await louezDb.db.insert(louezDb.oauthClients).values([
      {
        clientId: CLIENT,
        name: "Claude",
        uri: "https://claude.oa.test",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify(["https://client.oa.test/callback"]),
      },
      {
        clientId: OTHER_CLIENT,
        name: "Some agent",
        redirectUris: JSON.stringify(["https://other.oa.test/callback"]),
      },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    consentAnswers.length = 0;
    await louezDb.db.delete(louezDb.apiAgentGrants);
    await louezDb.db.delete(louezDb.apiOperations);
    await louezDb.db.delete(louezDb.apiRateLimits);
    await louezDb.db
      .delete(louezDb.storeMembers)
      .where(orm.eq(louezDb.storeMembers.storeId, STORE_LATER));
  });

  // --- Callers --------------------------------------------------------------

  const session = (userId = OWNER, store = STORE_A) => ({
    headers: new Headers({ [SESSION_HEADER]: userId, cookie: `louez_active_store=${store}` }),
    transport: "rpc" as const,
    ports,
    receipt: {} as { operationId?: string },
  });

  /** A token as the provider issues it: naming the user's current grant for the client. */
  const signFor = async (claims: Partial<Parameters<typeof tokens.sign>[0]> = {}) => {
    const userId = claims.userId ?? OWNER;
    const clientId = claims.clientId ?? CLIENT;
    const current = await grants.loadActiveGrant({ userId, clientId });
    return tokens.sign({ userId, clientId, grantId: current?.id ?? null, ...claims });
  };

  const bearer = async (
    claims: Partial<Parameters<typeof tokens.sign>[0]> = {},
    extra: Record<string, string> = {},
    transport: "mcp" | "openapi" | "rpc" = "mcp",
  ) => ({
    headers: new Headers({ authorization: `Bearer ${await signFor(claims)}`, ...extra }),
    transport,
    ports,
    receipt: {} as { operationId?: string },
  });

  const call = <T>(procedure: unknown, input: unknown, context: object, path: string[]) =>
    orpc.call(procedure as never, input as never, {
      context: context as never,
      path,
    }) as Promise<T>;

  const listStores = (context: object) =>
    call<{ items: Array<{ id: string; role: string }> }>(stores.list, {}, context, [
      "dashboard",
      "stores",
      "list",
    ]);
  const readNotes = (context: object) =>
    call<{ storeId: string }>(fixture.fixture.notes.list, {}, context, [
      "fixture",
      "notes",
      "list",
    ]);
  const removeNote = (context: object) =>
    call<{ removed: boolean }>(fixture.fixture.notes.remove, { id: "n1" }, context, [
      "fixture",
      "notes",
      "remove",
    ]);

  async function rejects(promise: Promise<unknown>, code: string) {
    await assert.rejects(promise, (error: unknown) => {
      assert.equal((error as { data?: { code?: string } }).data?.code, code, String(error));
      return true;
    });
  }

  const grant = (
    terms: Partial<Parameters<typeof grants.saveGrant>[0]["terms"]> = {},
    userId = OWNER,
  ) =>
    grants.saveGrant({
      userId,
      clientId: CLIENT,
      terms: {
        stores: { all: false, ids: [STORE_A] },
        preset: "write",
        confirmSensitive: true,
        bundles: ["daily"],
        ...terms,
      },
    });

  // --- Consent ----------------------------------------------------------------

  test("the consent shows the client and the user's stores, then records the grant before the code", async () => {
    const oauthQuery = new URLSearchParams({
      client_id: CLIENT,
      redirect_uri: "https://client.oa.test/callback",
      sig: "ok",
    }).toString();
    const asked = await call<{
      client: {
        name: string;
        declaredBy: string;
        verified: boolean;
        iconUrl: string | null;
        redirectHost: string;
      };
      stores: Array<{ id: string; role: string }>;
      current: unknown;
    }>(connections.getAuthorization, { oauthQuery }, session(), [
      "dashboard",
      "agentConnections",
      "getAuthorization",
    ]);
    assert.equal(asked.client.name, "Claude");
    assert.equal(asked.client.declaredBy, "claude.oa.test", "declared by its document's host");
    assert.equal(asked.client.verified, false, "a metadata document alone verifies nothing");
    assert.equal(
      asked.client.iconUrl,
      `/api/agent-connections/client-icon?client_id=${encodeURIComponent(CLIENT)}`,
      "the icon of the host that declared it",
    );
    assert.equal(asked.client.redirectHost, "client.oa.test");
    assert.deepEqual(
      asked.stores.map((store) => [store.id, store.role]),
      [
        [STORE_A, "owner"],
        [STORE_B, "owner"],
      ],
    );
    assert.equal(asked.current, null);

    const answered = await call<{ redirectUrl: string }>(
      connections.authorize,
      {
        oauthQuery,
        accept: true,
        stores: { all: false, ids: [STORE_A, STORE_B] },
        preset: "read",
        confirmSensitive: true,
        bundles: ["daily", "catalog", "daily"],
      },
      session(),
      ["dashboard", "agentConnections", "authorize"],
    );
    assert.equal(answered.redirectUrl, "https://client.oa.test/callback?code=the-code");
    assert.deepEqual(consentAnswers, [{ oauthQuery, accept: true }]);

    const saved = await grants.loadActiveGrant({ userId: OWNER, clientId: CLIENT });
    assert.equal(saved?.preset, "read");
    assert.deepEqual(saved?.bundles, ["daily", "catalog"]);
    assert.deepEqual(saved?.stores?.sort(), [STORE_A, STORE_B]);

    // The consent is recorded in the journal, never with its code.
    const [operation] = await louezDb.db
      .select()
      .from(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.procedure, "dashboard.agentConnections.authorize"));
    assert.equal(operation?.credentialKind, "session");
    assert.equal(operation?.result, null);

    // Asking again starts from what was granted.
    const again = await call<{ current: { preset: string } | null }>(
      connections.getAuthorization,
      { oauthQuery },
      session(),
      ["dashboard", "agentConnections", "getAuthorization"],
    );
    assert.equal(again.current?.preset, "read");
  });

  test("a client claiming a known name shows who declared it and where the code goes", async () => {
    await louezDb.db.insert(louezDb.oauthClients).values([
      {
        clientId: "https://evil.oa.test/claude.json",
        name: "Claude",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify([
          "https://claude.oa.test/callback",
          "https://evil.oa.test/cb",
        ]),
      },
      {
        clientId: "dcr-claude-lookalike",
        name: "Claude",
        redirectUris: JSON.stringify(["http://127.0.0.1/callback"]),
      },
    ]);
    const ask = (clientId: string, redirectUri: string) =>
      call<{
        client: {
          name: string;
          declaredBy: string | null;
          verified: boolean;
          iconUrl: string | null;
          redirectHost: string;
          loopbackRedirect: boolean;
        };
      }>(
        connections.getAuthorization,
        {
          oauthQuery: new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            sig: "ok",
          }).toString(),
        },
        session(),
        ["dashboard", "agentConnections", "getAuthorization"],
      );

    // The request's redirect, not the first registered one.
    const lookalike = await ask("https://evil.oa.test/claude.json", "https://evil.oa.test/cb");
    assert.deepEqual(lookalike.client, {
      clientId: "https://evil.oa.test/claude.json",
      name: "Claude",
      declaredBy: "evil.oa.test",
      verified: false,
      iconUrl:
        "/api/agent-connections/client-icon?client_id=https%3A%2F%2Fevil.oa.test%2Fclaude.json",
      redirectHost: "evil.oa.test",
      loopbackRedirect: false,
    });

    const registered = await ask("dcr-claude-lookalike", "http://127.0.0.1:53111/callback");
    assert.equal(registered.client.declaredBy, null, "registered itself: declared by nobody");
    assert.equal(registered.client.iconUrl, null, "its declared logo is never shown");
    assert.equal(registered.client.verified, false);
    assert.equal(registered.client.redirectHost, "127.0.0.1:53111");
    assert.equal(registered.client.loopbackRedirect, true);
  });

  test("refusing grants nothing; a bad query, a foreign store or an unknown client is refused", async () => {
    const oauthQuery = `client_id=${encodeURIComponent(CLIENT)}&sig=ok`;
    const refused = await call<{ redirectUrl: string }>(
      connections.authorize,
      { oauthQuery, accept: false },
      session(),
      ["dashboard", "agentConnections", "authorize"],
    );
    assert.match(refused.redirectUrl, /error=access_denied/);
    assert.equal(await grants.loadActiveGrant({ userId: OWNER, clientId: CLIENT }), null);

    const terms = {
      accept: true,
      stores: { all: false, ids: [STORE_A] },
      preset: "write",
      confirmSensitive: true,
      bundles: ["daily"],
    };
    const path = ["dashboard", "agentConnections", "authorize"];
    await rejects(
      call(
        connections.authorize,
        { ...terms, oauthQuery: `client_id=${CLIENT}&sig=forged` },
        session(),
        path,
      ),
      "OAUTH_REQUEST_INVALID",
    );
    await rejects(
      call(
        connections.authorize,
        { ...terms, oauthQuery, stores: { all: false, ids: [STORE_LATER] } },
        session(),
        path,
      ),
      "AGENT_CONNECTION_STORE_INVALID",
    );
    await rejects(
      call(
        connections.authorize,
        { ...terms, oauthQuery: "client_id=nobody&sig=ok" },
        session(),
        path,
      ),
      "OAUTH_CLIENT_NOT_FOUND",
    );
    assert.equal(consentAnswers.filter((answer) => answer.accept).length, 0);
  });

  test("granting, listing, changing and revoking are for a session only", async () => {
    await grant();
    const token = await bearer();
    const key = (path: string) => ["dashboard", "agentConnections", path];
    await rejects(call(connections.list, {}, token, key("list")), "SESSION_ONLY");
    await rejects(
      call(connections.update, { id: "x", preset: "write" }, await bearer(), key("update")),
      "SESSION_ONLY",
    );
    await rejects(
      call(connections.revoke, { id: "x" }, await bearer(), key("revoke")),
      "SESSION_ONLY",
    );
    await rejects(
      call(
        connections.authorize,
        { oauthQuery: `client_id=${CLIENT}&sig=ok`, accept: false },
        await bearer(),
        key("authorize"),
      ),
      "SESSION_ONLY",
    );
  });

  // --- The access token --------------------------------------------------------

  test("a valid token acts with the grant's terms; a bad one fails closed", async () => {
    await grant();
    assert.equal((await readNotes(await bearer())).storeId, STORE_A, "one store: no header needed");

    await rejects(
      readNotes(await bearer({ audience: "https://app.louez.test/api/v1" })),
      "UNAUTHENTICATED",
    );
    await rejects(
      readNotes(await bearer({ issuer: "https://evil.test/api/auth" })),
      "UNAUTHENTICATED",
    );
    await rejects(readNotes(await bearer({ expiresIn: -120 })), "UNAUTHENTICATED");
    // A token of another client, that the user never granted anything.
    await rejects(readNotes(await bearer({ clientId: OTHER_CLIENT })), "UNAUTHENTICATED");
    await rejects(
      readNotes({
        ...(await bearer()),
        headers: new Headers({ authorization: "Bearer not.a.token" }),
      }),
      "UNAUTHENTICATED",
    );
    // OpenAPI takes API keys only, RPC sessions only: a token is not accepted there.
    await rejects(readNotes(await bearer({}, {}, "openapi")), "CREDENTIAL_NOT_ACCEPTED");
    await rejects(readNotes(await bearer({}, {}, "rpc")), "CREDENTIAL_NOT_ACCEPTED");
  });

  test("a disabled client and a revoked grant are refused on the next call", async () => {
    const { id } = await grant();
    // Better Auth's side of the connection, revoked with the grant.
    await louezDb.db.insert(louezDb.oauthConsents).values({
      clientId: CLIENT,
      userId: OWNER,
      referenceId: id,
      scopes: JSON.stringify(["openid"]),
    });
    await louezDb.db.insert(louezDb.oauthRefreshTokens).values({
      token: "hashed-refresh-token",
      clientId: CLIENT,
      userId: OWNER,
      referenceId: id,
      scopes: JSON.stringify(["openid", "offline_access"]),
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    });
    const token = await bearer();
    await readNotes(token);

    await louezDb.db
      .update(louezDb.oauthClients)
      .set({ disabled: true })
      .where(orm.eq(louezDb.oauthClients.clientId, CLIENT));
    await rejects(readNotes(token), "UNAUTHENTICATED");
    await louezDb.db
      .update(louezDb.oauthClients)
      .set({ disabled: false })
      .where(orm.eq(louezDb.oauthClients.clientId, CLIENT));
    await readNotes(token);

    await call(connections.revoke, { id }, session(), ["dashboard", "agentConnections", "revoke"]);
    await rejects(readNotes(token), "UNAUTHENTICATED");

    const consents = await louezDb.db
      .select()
      .from(louezDb.oauthConsents)
      .where(orm.eq(louezDb.oauthConsents.userId, OWNER));
    assert.equal(consents.length, 0, "the next authorization asks again");
    const refreshTokens = await louezDb.db
      .select({ id: louezDb.oauthRefreshTokens.id })
      .from(louezDb.oauthRefreshTokens)
      .where(orm.eq(louezDb.oauthRefreshTokens.token, "hashed-refresh-token"));
    assert.equal(refreshTokens.length, 0, "the grant's lineage went with it: no new access token");

    await rejects(
      call(connections.revoke, { id }, session(), ["dashboard", "agentConnections", "revoke"]),
      "AGENT_CONNECTION_NOT_FOUND",
    );
  });

  test("a token issued before a revoke stays refused once the same client reconnects", async () => {
    const first = await grant();
    const old = await bearer();
    await readNotes(old);

    await call(connections.revoke, { id: first.id }, session(), [
      "dashboard",
      "agentConnections",
      "revoke",
    ]);
    const second = await grant();
    assert.notEqual(second.id, first.id, "reconnecting makes a new grant");

    await rejects(readNotes(old), "UNAUTHENTICATED");
    assert.equal((await readNotes(await bearer())).storeId, STORE_A, "the new token works");
    // A token naming no grant, or another one, is refused too.
    await rejects(readNotes(await bearer({ grantId: null })), "UNAUTHENTICATED");
    await rejects(readNotes(await bearer({ grantId: "oa_some_other_grant_" })), "UNAUTHENTICATED");
  });

  test("a member removed from the store is refused on the next call", async () => {
    await grant({}, MEMBER);
    const token = await bearer({ userId: MEMBER });
    assert.equal((await readNotes(token)).storeId, STORE_A);
    await louezDb.db
      .delete(louezDb.storeMembers)
      .where(
        orm.and(
          orm.eq(louezDb.storeMembers.storeId, STORE_A),
          orm.eq(louezDb.storeMembers.userId, MEMBER),
        ),
      );
    try {
      await rejects(readNotes(token), "NO_STORE_ACCESS");
    } finally {
      await louezDb.db
        .insert(louezDb.storeMembers)
        .values({ storeId: STORE_A, userId: MEMBER, role: "member" });
    }
  });

  // --- Stores ------------------------------------------------------------------

  test("a grant over several stores needs Louez-Store, within the granted stores", async () => {
    await grant({ stores: { all: false, ids: [STORE_A, STORE_B] } });
    await rejects(readNotes(await bearer()), "STORE_REQUIRED");
    assert.equal((await readNotes(await bearer({}, { "louez-store": STORE_B }))).storeId, STORE_B);
    await rejects(readNotes(await bearer({}, { "louez-store": STORE_LATER })), "NO_STORE_ACCESS");

    const listed = await listStores(await bearer());
    assert.deepEqual(
      listed.items.map((store) => [store.id, store.role]),
      [
        [STORE_A, "owner"],
        [STORE_B, "owner"],
      ],
    );
  });

  test("a grant over all stores includes a store the user joins later", async () => {
    await grant({ stores: { all: true } }, MEMBER);
    const token = await bearer({ userId: MEMBER });
    assert.deepEqual(
      (await listStores(token)).items.map((store) => store.id),
      [STORE_A],
    );
    assert.equal((await readNotes(token)).storeId, STORE_A, "one store reached: no header needed");

    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE_LATER, userId: MEMBER, role: "owner" });
    const later = await listStores(await bearer({ userId: MEMBER }));
    assert.deepEqual(
      later.items.map((store) => [store.id, store.role]),
      [
        [STORE_A, "member"],
        [STORE_LATER, "owner"],
      ],
    );
    await rejects(readNotes(await bearer({ userId: MEMBER })), "STORE_REQUIRED");
  });

  // --- Rights ------------------------------------------------------------------

  test("the preset is cut down by the role; the confirmation follows the grant", async () => {
    // Read only: no write, whatever the role.
    await grant({ preset: "read" });
    await rejects(removeNote(await bearer()), "PERMISSION_DENIED");

    // Read and write, confirmation on: a sensitive write asks first.
    await grant({ preset: "write", confirmSensitive: true });
    await rejects(removeNote(await bearer()), "CONFIRMATION_REQUIRED");

    // Confirmation off: it runs, and the journal names the connection.
    await grant({ preset: "write", confirmSensitive: false });
    const context = await bearer();
    assert.equal((await removeNote(context)).removed, true);
    const [operation] = await louezDb.db
      .select()
      .from(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.procedure, "fixture.notes.remove"));
    const active = await grants.loadActiveGrant({ userId: OWNER, clientId: CLIENT });
    assert.equal(operation?.credentialKind, "oauth");
    assert.equal(operation?.credentialId, active?.id);
    assert.equal(operation?.clientName, "Claude");
    assert.equal(operation?.transport, "mcp");

    // A member with the write preset still cannot delete: the role says no.
    await grant({ preset: "write", confirmSensitive: false }, MEMBER);
    await rejects(removeNote(await bearer({ userId: MEMBER })), "PERMISSION_DENIED");
  });

  test("a platform admin gets no staff powers through a token", async () => {
    const previous = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_ADMIN_EMAILS = "owner@oa.test";
    try {
      await grant();
      const { resolveAccountActor } = await import("./actor");
      const actor = await resolveAccountActor({
        transport: "mcp",
        headers: (await bearer()).headers,
      });
      assert.equal(actor.isPlatformAdmin, false);
      assert.equal(actor.credential.kind, "oauth");
    } finally {
      process.env.PLATFORM_ADMIN_EMAILS = previous;
    }
  });

  // --- The "Agents connectés" screen -------------------------------------------

  test("the list shows each grant with its stores and last action; a change applies on the next call", async () => {
    const { id } = await grant({ stores: { all: false, ids: [STORE_A] }, confirmSensitive: false });
    await removeNote(await bearer());

    const listed = await call<{
      items: Array<{
        id: string;
        client: { name: string; iconUrl: string | null };
        stores: { all: boolean; items?: Array<{ id: string }> };
        lastActionAt: Date | null;
      }>;
      stores: Array<{ id: string }>;
    }>(connections.list, {}, session(), ["dashboard", "agentConnections", "list"]);
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].id, id);
    assert.equal(listed.items[0].client.name, "Claude");
    assert.ok(listed.items[0].client.iconUrl, "the list shows the icon too");
    assert.deepEqual(
      listed.items[0].stores.items?.map((store) => store.id),
      [STORE_A],
    );
    assert.ok(listed.items[0].lastActionAt, "the last write is the last action");
    assert.deepEqual(
      listed.stores.map((store) => store.id),
      [STORE_A, STORE_B],
    );

    // Another member's session sees none of the owner's connections.
    const theirs = await call<{ items: unknown[] }>(connections.list, {}, session(MEMBER), [
      "dashboard",
      "agentConnections",
      "list",
    ]);
    assert.equal(theirs.items.length, 0);
    await rejects(
      call(connections.update, { id, preset: "read" }, session(MEMBER), [
        "dashboard",
        "agentConnections",
        "update",
      ]),
      "AGENT_CONNECTION_NOT_FOUND",
    );

    // Read only from now on: the same token's next write is refused.
    const updated = await call<{ preset: string; confirmSensitive: boolean }>(
      connections.update,
      { id, preset: "read" },
      session(),
      ["dashboard", "agentConnections", "update"],
    );
    assert.equal(updated.preset, "read");
    assert.equal(updated.confirmSensitive, false, "an absent field is left as is");
    await rejects(removeNote(await bearer()), "PERMISSION_DENIED");

    // The change is in the journal, made by the session.
    const recorded = await louezDb.db
      .select()
      .from(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.procedure, "dashboard.agentConnections.update"));
    assert.equal(recorded[0]?.credentialKind, "session");
  });

  // --- Client icons -----------------------------------------------------------

  test("only a client from a metadata document has an icon, from its client id's origin", async () => {
    const asked: string[] = [];
    const lookup = async (origin: string) => {
      asked.push(origin);
      return { contentType: "image/png" as const, body: new Uint8Array([1]) };
    };

    const icon = await icons.loadAgentClientIcon(CLIENT, lookup);
    assert.equal(icon?.contentType, "image/png");
    assert.deepEqual(asked, ["https://claude.oa.test"], "the stored id's origin, not its uri");

    assert.equal(await icons.loadAgentClientIcon(OTHER_CLIENT, lookup), null, "registered itself");
    assert.equal(await icons.loadAgentClientIcon("https://unknown.oa.test/c.json", lookup), null);

    await louezDb.db
      .update(louezDb.oauthClients)
      .set({ disabled: true })
      .where(orm.eq(louezDb.oauthClients.clientId, CLIENT));
    try {
      assert.equal(await icons.loadAgentClientIcon(CLIENT, lookup), null, "a disabled client");
    } finally {
      await louezDb.db
        .update(louezDb.oauthClients)
        .set({ disabled: false })
        .where(orm.eq(louezDb.oauthClients.clientId, CLIENT));
    }
    assert.deepEqual(asked, ["https://claude.oa.test"], "nothing else was fetched");
  });
});
