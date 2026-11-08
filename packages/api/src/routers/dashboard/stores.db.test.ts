import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { createMemoryStorage } from "../../platform/memory-storage";
import type { NewStorePort } from "../../platform/ports";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls } from "../../platform/test-urls";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A store created before any store exists: by the onboarding (a session), or
// by an agent over OAuth, through `stores.create`, on the database. Better
// Auth stays out: a session is read from a test header, access tokens are
// signed with a test key, and the consent's signed query is "signed" when it
// says `sig=ok`.

const ISSUER = "https://app.louez.test/api/auth";
const RESOURCE = "https://app.louez.test/api/mcp";
const SESSION_HEADER = "x-test-session-user";

let tokens: Awaited<ReturnType<typeof createTestAccessTokens>>;

mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@sc.test` } } : null;
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
    answerConsent: async (input: { accept: boolean }) =>
      input.accept
        ? "https://client.sc.test/callback?code=the-code"
        : "https://client.sc.test/callback?error=access_denied",
  },
});

const NEW_USER = "sc_new_user_00000001";
const OWNER = "sc_owner_user_000001";
const OWNER_STORE = "sc_owner_store_00001";
const REFERRER_USER = "sc_referrer_user_001";
const REFERRER_STORE = "sc_referrer_store_01";
const REFERRAL_CODE = "LOUEZABCDEFG";
const CLIENT = "https://claude.sc.test/oauth/client.json";

describe(
  "stores.create and agent connections without a store (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orpc: typeof import("@orpc/server");
    let orm: typeof import("drizzle-orm");
    let grants: typeof import("../../services/agent-grants");
    let apiKeys: typeof import("../../services/api-keys");
    let stores: typeof import("./stores").dashboardStoresRouter;
    let connections: typeof import("./agent-connections").dashboardAgentConnectionsRouter;

    let dispatched: string[] = [];
    let subscriptionCalls: Array<{ storeId: string; currency: string; referred: boolean }> = [];
    let newStores: Partial<NewStorePort> = {};
    const ports = {
      planFeatures: async () => ({ apiAccess: true }),
      runReservationEffects: async () => {},
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      dispatchEffects: (ids: readonly string[]) => {
        dispatched.push(...ids);
      },
      storage: createMemoryStorage(),
      urls: createTestUrls(),
      afterCommit: () => {},
      // Read at each call, so a test can change one part.
      get newStores() {
        return createTestNewStores({
          insertSubscription: async (_tx, input) => {
            subscriptionCalls.push(input);
            return false;
          },
          ...newStores,
        });
      },
    };

    before(async () => {
      tokens = await createTestAccessTokens({ issuer: ISSUER, audience: RESOURCE });
      database = await createTestDatabase("api_store_create");
      louezDb = await import("@louez/db");
      orpc = await import("@orpc/server");
      orm = await import("drizzle-orm");
      grants = await import("../../services/agent-grants");
      apiKeys = await import("../../services/api-keys");
      ({ dashboardStoresRouter: stores } = await import("./stores"));
      ({ dashboardAgentConnectionsRouter: connections } = await import("./agent-connections"));

      await louezDb.db.insert(louezDb.users).values([
        { id: OWNER, email: "owner@sc.test" },
        { id: REFERRER_USER, email: "referrer@sc.test" },
      ]);
      await louezDb.db.insert(louezDb.stores).values([
        { id: OWNER_STORE, userId: OWNER, name: "Owner store", slug: "sc-owner" },
        {
          id: REFERRER_STORE,
          userId: REFERRER_USER,
          name: "Referrer",
          slug: "sc-referrer",
          referralCode: REFERRAL_CODE,
          onboardingCompleted: true,
        },
      ]);
      await louezDb.db.insert(louezDb.storeMembers).values([
        { storeId: OWNER_STORE, userId: OWNER, role: "owner" },
        { storeId: REFERRER_STORE, userId: REFERRER_USER, role: "owner" },
      ]);
      await louezDb.db.insert(louezDb.oauthClients).values({
        clientId: CLIENT,
        name: "Claude",
        uri: "https://claude.sc.test",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify(["https://client.sc.test/callback"]),
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      dispatched = [];
      subscriptionCalls = [];
      newStores = {};
      await louezDb.db.delete(louezDb.apiAgentGrants);
      await louezDb.db.delete(louezDb.apiOperations);
      await louezDb.db.delete(louezDb.apiConfirmations);
      await louezDb.db.delete(louezDb.apiRateLimits);
      await louezDb.db.delete(louezDb.apiEffects);
      // A fresh account with no store, for each test.
      const created = await louezDb.db
        .select({ id: louezDb.stores.id })
        .from(louezDb.stores)
        .where(orm.eq(louezDb.stores.userId, NEW_USER));
      for (const { id } of created) {
        await louezDb.db
          .delete(louezDb.storeMembers)
          .where(orm.eq(louezDb.storeMembers.storeId, id));
        await louezDb.db.delete(louezDb.stores).where(orm.eq(louezDb.stores.id, id));
      }
      await louezDb.db.delete(louezDb.users).where(orm.eq(louezDb.users.id, NEW_USER));
      await louezDb.db.insert(louezDb.users).values({ id: NEW_USER, email: "new@sc.test" });
    });

    // --- Callers ----------------------------------------------------------------

    const session = (userId = NEW_USER, extra: Record<string, string> = {}) => ({
      headers: new Headers({ [SESSION_HEADER]: userId, ...extra }),
      transport: "rpc" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    });

    const grant = (terms: Partial<Parameters<typeof grants.saveGrant>[0]["terms"]> = {}) =>
      grants.saveGrant({
        userId: NEW_USER,
        clientId: CLIENT,
        terms: {
          stores: { all: true },
          preset: "write",
          confirmSensitive: true,
          bundles: ["daily"],
          ...terms,
        },
      });

    const agent = async (extra: Record<string, string> = {}) => {
      const current = await grants.loadActiveGrant({ userId: NEW_USER, clientId: CLIENT });
      const token = await tokens.sign({
        userId: NEW_USER,
        clientId: CLIENT,
        grantId: current?.id ?? null,
      });
      return {
        headers: new Headers({ authorization: `Bearer ${token}`, ...extra }),
        transport: "mcp" as const,
        ports,
        receipt: {} as { operationId?: string; replayed?: boolean },
      };
    };

    const call = <T>(procedure: unknown, input: unknown, context: object, name: string) =>
      orpc.call(procedure as never, input as never, {
        context: context as never,
        path: ["dashboard", "stores", name],
      }) as Promise<T>;

    interface Created {
      id: string;
      slug: string;
      online: boolean;
      timezone: string;
      links: { dashboard: string; storefront?: string };
      futureStorefrontUrl: string;
      pricing: { billing: string; summary: string };
      nextSteps: string[];
    }
    const create = (context: object, input: Record<string, unknown> = {}) =>
      call<Created>(
        stores.create,
        {
          name: "Brest Surf Rental",
          slug: "brest-surf",
          country: "FR",
          currency: "EUR",
          address: "1 quai de la Douane, 29200 Brest",
          email: "hello@brest-surf.test",
          phone: "+33298000000",
          ...input,
        },
        context,
        "create",
      );
    const listStores = (context: object) =>
      call<{ items: Array<{ id: string }>; hint?: string }>(stores.list, {}, context, "list");

    async function rejects(promise: Promise<unknown>, code: string) {
      let caught: unknown;
      await assert.rejects(promise, (error: unknown) => {
        caught = error;
        assert.equal((error as { data?: { code?: string } }).data?.code, code, String(error));
        return true;
      });
      return caught as { message: string; data: { details?: Record<string, unknown> } };
    }

    /** Confirms an agent's create: the preview, then the same call with its token. */
    async function confirmed(
      input: Record<string, unknown> = {},
      extra: Record<string, string> = {},
    ) {
      const refused = await rejects(create(await agent(extra), input), "CONFIRMATION_REQUIRED");
      const token = String(refused.data.details?.confirmationToken);
      return create(await agent({ ...extra, "louez-confirmation": token }), input);
    }

    const storesOf = (userId: string) =>
      louezDb.db
        .select({ id: louezDb.stores.id, slug: louezDb.stores.slug })
        .from(louezDb.stores)
        .where(orm.eq(louezDb.stores.userId, userId));

    // --- Creation -----------------------------------------------------------------

    test("a session creates the store as the onboarding did: settings, owner, billing, credits, analytics", async () => {
      const created = await create(session());

      const row = await louezDb.db.query.stores.findFirst({
        where: orm.eq(louezDb.stores.id, created.id),
      });
      assert.ok(row);
      assert.equal(row.name, "Brest Surf Rental");
      assert.equal(row.slug, "brest-surf");
      assert.equal(row.userId, NEW_USER);
      assert.equal(row.address, "1 quai de la Douane, 29200 Brest");
      assert.equal(row.email, "hello@brest-surf.test");
      assert.equal(row.phone, "+33298000000");
      assert.equal(row.onboardingCompleted, false, "offline until the user launches it");
      assert.match(
        row.referralCode ?? "",
        /^LOUEZ[A-HJ-NP-Z2-9]{7}$/,
        "a referral code of its own",
      );
      assert.equal(row.referredByStoreId, null);
      const settings = row.settings as Record<string, unknown>;
      assert.equal(settings.reservationMode, "payment");
      assert.equal(settings.minRentalMinutes, 60);
      assert.equal(settings.maxRentalMinutes, null);
      assert.equal(settings.advanceNoticeMinutes, 1440);
      assert.equal(settings.turnoverBufferMinutes, 0);
      assert.equal(settings.country, "FR");
      assert.equal(settings.currency, "EUR");
      assert.equal(settings.timezone, "Europe/Paris");
      assert.ok(settings.businessHours, "the default business hours");

      const [member] = await louezDb.db
        .select({ userId: louezDb.storeMembers.userId, role: louezDb.storeMembers.role })
        .from(louezDb.storeMembers)
        .where(orm.eq(louezDb.storeMembers.storeId, created.id));
      assert.deepEqual(member, { userId: NEW_USER, role: "owner" });

      // The subscription row is the billing code's, in the same transaction.
      assert.deepEqual(subscriptionCalls, [
        { storeId: created.id, currency: "EUR", referred: false },
      ]);

      // Credits and analytics are outbox rows, dispatched once committed.
      const effects = await louezDb.db
        .select({
          id: louezDb.apiEffects.id,
          type: louezDb.apiEffects.type,
          payload: louezDb.apiEffects.payload,
        })
        .from(louezDb.apiEffects)
        .where(orm.eq(louezDb.apiEffects.storeId, created.id))
        .orderBy(louezDb.apiEffects.seq);
      assert.deepEqual(
        effects.map((effect) => [effect.type, effect.payload.event ?? null]),
        [
          ["store.welcomeCredits", null],
          ["store.creationAnalytics", "referral_attribution_resolved"],
          ["store.creationAnalytics", "store_info_saved"],
        ],
      );
      assert.deepEqual(dispatched.sort(), effects.map((effect) => effect.id).sort());
      const saved = effects[2]?.payload.properties as Record<string, unknown>;
      assert.equal(saved.has_address, true);
      assert.equal(saved.has_phone, true);
      assert.equal(saved.has_coordinates, false);
      assert.equal(saved.referral_outcome, "no_cookie");

      // The answer: offline, a dashboard link, no storefront yet, and what to do next.
      assert.equal(created.online, false);
      assert.equal(created.links.dashboard, `https://app.louez.test/dashboard?store=${created.id}`);
      assert.equal(created.links.storefront, undefined);
      assert.equal(created.futureStorefrontUrl, "https://brest-surf.louez.test");
      assert.equal(created.timezone, "Europe/Paris");
      assert.ok(created.nextSteps.some((step) => step.includes("products_create")));

      // Recorded on the account scope.
      const [operation] = await louezDb.db
        .select({
          storeId: louezDb.apiOperations.storeId,
          status: louezDb.apiOperations.status,
          targetId: louezDb.apiOperations.targetId,
        })
        .from(louezDb.apiOperations)
        .where(orm.eq(louezDb.apiOperations.procedure, "dashboard.stores.create"));
      assert.deepEqual(operation, { storeId: "", status: "succeeded", targetId: created.id });
    });

    test("a dashboard request's referral and sign-up origin are recorded; the reward event only for a billed store", async () => {
      newStores = {
        signupAttribution: () => ({ referralCode: REFERRAL_CODE, signupOrigin: "reeent" }),
        insertSubscription: async (_tx, input) => {
          subscriptionCalls.push(input);
          return true;
        },
      };
      const created = await create(session());
      const row = await louezDb.db.query.stores.findFirst({
        where: orm.eq(louezDb.stores.id, created.id),
        columns: { referredByStoreId: true, referredByUserId: true, signupOrigin: true },
      });
      assert.deepEqual(row, {
        referredByStoreId: REFERRER_STORE,
        referredByUserId: REFERRER_USER,
        signupOrigin: "reeent",
      });
      const user = await louezDb.db.query.users.findFirst({
        where: orm.eq(louezDb.users.id, NEW_USER),
        columns: { signupOrigin: true },
      });
      assert.equal(user?.signupOrigin, "reeent", "the user's first origin is kept");
      assert.deepEqual(subscriptionCalls[0]?.referred, true);
      const events = await louezDb.db
        .select({ payload: louezDb.apiEffects.payload })
        .from(louezDb.apiEffects)
        .where(orm.eq(louezDb.apiEffects.storeId, created.id));
      assert.ok(events.some((event) => event.payload.event === "referred_reward_granted"));

      // An agent's request carries no attribution, even if the port would read one.
      await grant();
      const byAgent = await confirmed({ slug: "brest-surf-two", name: "Second" });
      const agentRow = await louezDb.db.query.stores.findFirst({
        where: orm.eq(louezDb.stores.id, byAgent.id),
        columns: { referredByStoreId: true },
      });
      assert.equal(agentRow?.referredByStoreId, null);
    });

    test("an agent over all stores gets a preview with the terms, then creates the store and sees it", async () => {
      await grant();
      // No store yet: the list is empty, with a hint.
      const before = await listStores(await agent());
      assert.deepEqual(before.items, []);
      assert.match(before.hint ?? "", /stores_create/);

      const refused = await rejects(create(await agent()), "CONFIRMATION_REQUIRED");
      const preview = refused.data.details?.preview as {
        summary: string;
        details: Record<string, unknown>;
      };
      assert.match(preview.summary, /Brest Surf Rental/);
      assert.match(preview.summary, /billing relationship/);
      assert.equal(preview.details.futureStorefrontUrl, "https://brest-surf.louez.test");
      assert.equal(preview.details.country, "FR");
      assert.equal(preview.details.currency, "EUR");
      assert.equal((preview.details.pricing as { billing: string }).billing, "pay_as_you_go");
      assert.match(
        (preview.details.pricing as { summary: string }).summary,
        /first 15 reservations are free.*1\.00 EUR each for reservations 1 to 50, 0\.50 EUR each for reservations beyond 50/,
      );
      assert.equal((await storesOf(NEW_USER)).length, 0, "the preview creates nothing");

      const token = String(refused.data.details?.confirmationToken);
      const created = await create(await agent({ "louez-confirmation": token }));
      assert.equal(created.pricing.billing, "pay_as_you_go");

      // The grant over all stores reaches the store it created.
      const after = await listStores(await agent());
      assert.deepEqual(
        after.items.map((store) => store.id),
        [created.id],
      );
      assert.equal(after.hint, undefined);
    });

    test("a tampered or replayed token fails; a web address taken after the preview is a clean error", async () => {
      await grant();
      await rejects(
        create(await agent({ "louez-confirmation": "not-a-token" })),
        "CONFIRMATION_INVALID",
      );

      const refused = await rejects(create(await agent()), "CONFIRMATION_REQUIRED");
      const token = String(refused.data.details?.confirmationToken);
      // The same token for another input.
      await rejects(
        create(await agent({ "louez-confirmation": token }), { name: "Another name" }),
        "CONFIRMATION_INVALID",
      );

      // Another account takes the address between the preview and the call.
      const second = await rejects(
        create(await agent(), { slug: "sc-taken" }),
        "CONFIRMATION_REQUIRED",
      );
      await louezDb.db
        .insert(louezDb.stores)
        .values({ userId: OWNER, name: "Taken", slug: "sc-taken" });
      const taken = await rejects(
        create(
          await agent({ "louez-confirmation": String(second.data.details?.confirmationToken) }),
          {
            slug: "sc-taken",
          },
        ),
        "STORE_SLUG_TAKEN",
      );
      const suggestions = taken.data.details?.suggestions;
      assert.ok(Array.isArray(suggestions) && suggestions.length > 0);

      // A token is used once.
      const fresh = await rejects(create(await agent()), "CONFIRMATION_REQUIRED");
      const once = String(fresh.data.details?.confirmationToken);
      await create(await agent({ "louez-confirmation": once }));
      await rejects(
        create(await agent({ "louez-confirmation": once }), { slug: "brest-surf-again" }),
        "CONFIRMATION_INVALID",
      );
    });

    test("a retried create with its idempotency key never makes two stores, even concurrent", async () => {
      await grant({ confirmSensitive: false });
      const key = { "idempotency-key": "create-brest-1" };
      const first = await create(await agent(key));
      const replay = await create(await agent(key));
      assert.equal(replay.id, first.id);
      assert.equal((await storesOf(NEW_USER)).length, 1);

      // Two at once with a new key: one runs, the other waits or replays.
      const concurrentKey = { "idempotency-key": "create-brest-2" };
      const results = await Promise.allSettled([
        create(await agent(concurrentKey), { slug: "brest-surf-2" }),
        create(await agent(concurrentKey), { slug: "brest-surf-2" }),
      ]);
      const ids = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.id] : [],
      );
      assert.ok(ids.length >= 1);
      assert.equal(new Set(ids).size, 1);
      for (const result of results) {
        if (result.status === "rejected") {
          assert.equal(
            (result.reason as { data?: { code?: string } }).data?.code,
            "OPERATION_IN_PROGRESS",
          );
        }
      }
      assert.equal((await storesOf(NEW_USER)).length, 2);
    });

    test("two creates for one web address: one wins, the other gets STORE_SLUG_TAKEN", async () => {
      const results = await Promise.allSettled([
        create(session(), { slug: "brest-race", name: "One" }),
        create(session(OWNER), { slug: "brest-race", name: "Two" }),
      ]);
      const won = results.filter((result) => result.status === "fulfilled");
      const lost = results.filter((result) => result.status === "rejected");
      assert.equal(won.length, 1);
      assert.equal(lost.length, 1);
      assert.equal(
        ((lost[0] as PromiseRejectedResult).reason as { data?: { code?: string } }).data?.code,
        "STORE_SLUG_TAKEN",
      );
      const rows = await louezDb.db
        .select({ id: louezDb.stores.id })
        .from(louezDb.stores)
        .where(orm.eq(louezDb.stores.slug, "brest-race"));
      assert.equal(rows.length, 1);
      await louezDb.db
        .delete(louezDb.storeMembers)
        .where(orm.eq(louezDb.storeMembers.userId, OWNER));
      await louezDb.db
        .delete(louezDb.stores)
        .where(
          orm.and(orm.eq(louezDb.stores.userId, OWNER), orm.ne(louezDb.stores.id, OWNER_STORE)),
        );
      await louezDb.db
        .insert(louezDb.storeMembers)
        .values({ storeId: OWNER_STORE, userId: OWNER, role: "owner" });
    });

    test("an agent creates three stores a day at most; a session has no cap", async () => {
      await grant({ confirmSensitive: false });
      for (const n of [1, 2, 3]) await create(await agent(), { slug: `brest-cap-${n}` });
      const refused = await rejects(
        create(await agent(), { slug: "brest-cap-4" }),
        "STORE_CREATION_LIMIT",
      );
      assert.match(refused.message, /3 stores in the last 24 hours/);
      assert.equal((await storesOf(NEW_USER)).length, 3);

      // Stores made a day ago no longer count.
      await louezDb.db
        .update(louezDb.stores)
        .set({ createdAt: new Date(Date.now() - 25 * 3600_000) })
        .where(orm.eq(louezDb.stores.userId, NEW_USER));
      await create(await agent(), { slug: "brest-cap-5" });

      const viaDashboard = await create(session(), { slug: "brest-cap-6" });
      assert.ok(viaDashboard.id);
    });

    test("a read-only connection, one over chosen stores and an API key cannot create stores", async () => {
      await grant({ preset: "read" });
      await rejects(create(await agent()), "PERMISSION_DENIED");

      await grants.saveGrant({
        userId: OWNER,
        clientId: CLIENT,
        terms: {
          stores: { all: false, ids: [OWNER_STORE] },
          preset: "write",
          confirmSensitive: false,
          bundles: ["daily"],
        },
      });
      const bound = await grants.loadActiveGrant({ userId: OWNER, clientId: CLIENT });
      const ownerToken = await tokens.sign({
        userId: OWNER,
        clientId: CLIENT,
        grantId: bound?.id ?? null,
      });
      await rejects(
        create({
          headers: new Headers({ authorization: `Bearer ${ownerToken}` }),
          transport: "mcp",
          ports,
          receipt: {},
        }),
        "CONNECTION_BOUND_TO_STORES",
      );

      const key = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId: OWNER_STORE,
        userId: OWNER,
        name: "Script",
        permissions: {
          reservations: "write",
          products: "write",
          customers: "write",
          categories: "write",
          payments: "write",
          analytics: "read",
          settings: "write",
        },
      });
      await rejects(
        create({
          headers: new Headers({ authorization: `Bearer ${key.key}` }),
          transport: "openapi",
          ports,
          receipt: {},
        }),
        "CONNECTION_BOUND_TO_STORES",
      );
      assert.equal((await storesOf(NEW_USER)).length, 0);
    });

    test("a standalone instance with a store online refuses another one", async () => {
      newStores = { singleStore: () => true };
      await rejects(create(session()), "SINGLE_STORE_INSTANCE");
    });

    // --- Web address --------------------------------------------------------------

    test("checks a web address before creating, with free ones close to it", async () => {
      await grant();
      const context = await agent();
      const check = (slug: string) =>
        call<{ available: boolean; reason: string | null; suggestions: string[] }>(
          stores.checkSlugAvailability,
          { slug },
          context,
          "checkSlugAvailability",
        );
      assert.deepEqual(await check("brest-free"), {
        slug: "brest-free",
        available: true,
        reason: null,
        suggestions: [],
      });

      const taken = await check("sc-owner");
      assert.equal(taken.available, false);
      assert.equal(taken.reason, "taken");
      assert.deepEqual(taken.suggestions, ["sc-owner-2", "sc-owner-3", "sc-owner-4"]);

      const reserved = await check("admin");
      assert.equal(reserved.reason, "reserved");
      assert.ok(reserved.suggestions.every((slug) => slug !== "admin"));

      const fromName = await check("Surf à Brest !");
      assert.equal(fromName.reason, "invalid");
      assert.equal(fromName.suggestions[0], "surf-a-brest");
    });

    // --- Consent without a store --------------------------------------------------

    test("a user with no store can consent; the grant over all stores is recorded on the account", async () => {
      const oauthQuery = new URLSearchParams({
        client_id: CLIENT,
        redirect_uri: "https://client.sc.test/callback",
        sig: "ok",
      }).toString();
      const asked = await orpc.call(
        connections.getAuthorization as never,
        { oauthQuery } as never,
        {
          context: session() as never,
          path: ["dashboard", "agentConnections", "getAuthorization"],
        },
      );
      assert.deepEqual((asked as { stores: unknown[] }).stores, []);

      const answered = await orpc.call(
        connections.authorize as never,
        {
          oauthQuery,
          accept: true,
          stores: { all: true },
          preset: "write",
          confirmSensitive: true,
          bundles: ["daily"],
        } as never,
        { context: session() as never, path: ["dashboard", "agentConnections", "authorize"] },
      );
      assert.equal(
        (answered as { redirectUrl: string }).redirectUrl,
        "https://client.sc.test/callback?code=the-code",
      );
      const saved = await grants.loadActiveGrant({ userId: NEW_USER, clientId: CLIENT });
      assert.equal(saved?.stores, null, "every store, present and future");

      const [operation] = await louezDb.db
        .select({ storeId: louezDb.apiOperations.storeId })
        .from(louezDb.apiOperations)
        .where(orm.eq(louezDb.apiOperations.procedure, "dashboard.agentConnections.authorize"));
      assert.equal(operation?.storeId, "", "recorded on the account scope");

      // The agent then creates the store and reaches it.
      const created = await confirmed();
      const listed = await listStores(await agent());
      assert.deepEqual(
        listed.items.map((store) => store.id),
        [created.id],
      );
    });
  },
);
