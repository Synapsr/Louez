import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { ApiEffectPayloads } from "./effects";
import { createMemoryStorage } from "./memory-storage";
import { createTestNewStores } from "./test-new-stores";
import { createTestUrls } from "./test-urls";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A store set up end to end, through the procedures, on the database: by an
// agent over OAuth (Claude), by a human in the dashboard, and by both. Each
// agent write on the offline store, and its go-live, queues one setup action
// in the outbox; the go-live's analytics say who set the store up. Better
// Auth stays out: a session is read from a test header, access tokens are
// signed with a test key.

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
          return id ? { user: { id, email: `${id}@sa.test` } } : null;
        },
      },
    },
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
  },
});

const USER = "sa_user_000000000001";
const CLIENT = "https://claude.sa.test/oauth/client.json";

/** What a person typed: none of it may reach an analytics row. */
const PERSONAL = {
  name: "Brest Surf Rental",
  email: "jeanne.dupont@brest-surf.test",
  phone: "+33298000000",
  address: "1 quai de la Douane, 29200 Brest",
  description: "Planches de surf louées par Jeanne Dupont",
  productName: "Planche Jeanne",
  /** The name the OAuth client declared: it may hold anything. */
  clientName: "Claude de Jeanne Dupont (jeanne.dupont@brest-surf.test)",
} as const;

/** Keys whose values are ids or the event's identity, not what a person typed. */
const IDENTITY_KEY = /(^|_)id$|Id$|^eventUuid$|^occurredAt$/;

describe("setup analytics of a store (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let grants: typeof import("../services/agent-grants");
  let looksPersonal: typeof import("./setup-analytics").looksPersonal;
  let routers: {
    stores: typeof import("../routers/dashboard/stores").dashboardStoresRouter;
    settings: typeof import("../routers/dashboard/settings").dashboardSettingsRouter;
    products: typeof import("../routers/dashboard/products").dashboardProductsRouter;
  };

  let dispatched: string[] = [];
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores({ welcomeCredits: () => 0 }),
    dispatchEffects: (ids: readonly string[]) => {
      dispatched.push(...ids);
    },
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
    hostedBy: () => null,
  };

  before(async () => {
    tokens = await createTestAccessTokens({ issuer: ISSUER, audience: RESOURCE });
    database = await createTestDatabase("api_setup_analytics");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    grants = await import("../services/agent-grants");
    ({ looksPersonal } = await import("./setup-analytics"));
    routers = {
      stores: (await import("../routers/dashboard/stores")).dashboardStoresRouter,
      settings: (await import("../routers/dashboard/settings")).dashboardSettingsRouter,
      products: (await import("../routers/dashboard/products")).dashboardProductsRouter,
    };
    await louezDb.db.insert(louezDb.oauthClients).values({
      clientId: CLIENT,
      name: PERSONAL.clientName,
      uri: "https://claude.sa.test",
      clientDiscoveryId: "cimd",
      redirectUris: JSON.stringify(["https://client.sa.test/callback"]),
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    dispatched = [];
    const { db } = louezDb;
    for (const table of [
      louezDb.apiAgentGrants,
      louezDb.apiOperations,
      louezDb.apiConfirmations,
      louezDb.apiRateLimits,
      louezDb.apiEffects,
      louezDb.billingSyncQueue,
      louezDb.products,
      louezDb.storeMembers,
      louezDb.stores,
    ]) {
      await db.delete(table);
    }
    await db.delete(louezDb.users).where(orm.eq(louezDb.users.id, USER));
    await db.insert(louezDb.users).values({ id: USER, email: "owner@sa.test" });
    await grants.saveGrant({
      userId: USER,
      clientId: CLIENT,
      terms: {
        stores: { all: true },
        preset: "write",
        confirmSensitive: true,
        bundles: ["daily", "catalog", "settings"],
      },
    });
  });

  // --- Callers ----------------------------------------------------------------

  const session = (extra: Record<string, string> = {}) => ({
    headers: new Headers({ [SESSION_HEADER]: USER, ...extra }),
    transport: "rpc" as const,
    ports,
    receipt: {},
  });

  const agent = async (extra: Record<string, string> = {}) => {
    const current = await grants.loadActiveGrant({ userId: USER, clientId: CLIENT });
    const token = await tokens.sign({
      userId: USER,
      clientId: CLIENT,
      grantId: current?.id ?? null,
    });
    return {
      headers: new Headers({ authorization: `Bearer ${token}`, ...extra }),
      transport: "mcp" as const,
      ports,
      receipt: {},
    };
  };

  type Caller = (extra?: Record<string, string>) => object | Promise<object>;

  /** One call; an agent's sensitive one is previewed, then sent again with its token. */
  async function call<T>(
    domain: keyof typeof routers,
    name: string,
    input: unknown,
    caller: Caller,
    extra: Record<string, string> = {},
  ): Promise<T> {
    const procedure = (routers[domain] as Record<string, unknown>)[name];
    const once = async (headers: Record<string, string>) =>
      orpc.call(procedure as never, input as never, {
        context: (await caller({ ...extra, ...headers })) as never,
        path: ["dashboard", domain, name],
      }) as Promise<T>;
    try {
      return await once({});
    } catch (error) {
      const data = (error as { data?: { code?: string; details?: { confirmationToken?: string } } })
        .data;
      if (data?.code !== "CONFIRMATION_REQUIRED") throw error;
      return once({ "louez-confirmation": String(data.details?.confirmationToken) });
    }
  }

  const createStore = (caller: Caller) =>
    call<{ id: string }>(
      "stores",
      "create",
      {
        name: PERSONAL.name,
        slug: "sa-brest-surf",
        country: "FR",
        currency: "EUR",
        address: PERSONAL.address,
        email: PERSONAL.email,
        phone: PERSONAL.phone,
      },
      caller,
    );
  const updateInfo = (caller: Caller, storeId: string) =>
    call(
      "settings",
      "updateStoreInfo",
      { description: PERSONAL.description, phone: null, latitude: 48.38, longitude: -4.49 },
      caller,
      { "louez-store": storeId },
    );
  const createProduct = (caller: Caller, storeId: string) =>
    call(
      "products",
      "create",
      {
        name: PERSONAL.productName,
        price: "30",
        deposit: "150",
        rateTiers: [{ duration: 3, unit: "day", price: "75" }],
      },
      caller,
      { "louez-store": storeId },
    );
  const goLive = (caller: Caller, storeId: string) =>
    call<{ launched: boolean }>(
      "stores",
      "completeOnboarding",
      { reservationMode: "request" },
      caller,
      { "louez-store": storeId },
    );

  async function rows<K extends "store.agentSetupAction" | "store.launchAnalytics">(type: K) {
    const found = await louezDb.db
      .select({ id: louezDb.apiEffects.id, payload: louezDb.apiEffects.payload })
      .from(louezDb.apiEffects)
      .where(orm.eq(louezDb.apiEffects.type, type))
      .orderBy(louezDb.apiEffects.seq);
    // The JSON column holds the payload the type was added with.
    return found as unknown as Array<{ id: string; payload: ApiEffectPayloads[K] }>;
  }

  /** No analytics row holds what a person typed. */
  async function assertNoPersonalData() {
    const all = await louezDb.db
      .select({ type: louezDb.apiEffects.type, payload: louezDb.apiEffects.payload })
      .from(louezDb.apiEffects);
    for (const row of all.filter((entry) => entry.type !== "store.launchNotification")) {
      const json = JSON.stringify(row.payload);
      for (const value of Object.values(PERSONAL)) {
        assert.ok(!json.includes(value), `${row.type} holds "${value}"`);
      }
      // Ids and the event's own identity are ours, and may hold digits.
      const walk = (value: unknown, key = ""): void => {
        if (IDENTITY_KEY.test(key)) return;
        if (typeof value === "string") assert.ok(!looksPersonal(value), `${row.type}: ${value}`);
        else if (Array.isArray(value)) value.forEach((entry) => walk(entry));
        else if (value && typeof value === "object")
          for (const [name, entry] of Object.entries(value)) walk(entry, name);
      };
      walk(row.payload);
    }
  }

  // --- An agent ---------------------------------------------------------------

  test("an agent's setup, create → info → product → go-live, queues one action each, with safe facts", async () => {
    const store = await createStore(agent);
    await updateInfo(agent, store.id);
    await createProduct(agent, store.id);
    const launched = await goLive(agent, store.id);
    assert.equal(launched.launched, true);

    const actions = (await rows("store.agentSetupAction")).map((row) => row.payload);
    assert.deepEqual(
      actions.map((action) => action.procedure),
      ["stores.create", "settings.updateStoreInfo", "products.create", "stores.completeOnboarding"],
    );
    for (const action of actions) {
      assert.equal(action.storeId, store.id);
      assert.equal(action.ownerUserId, USER);
      assert.equal(action.credentialKind, "oauth");
      assert.equal(action.agentClient, "claude");
      assert.equal(action.transport, "mcp");
      assert.match(action.eventUuid, /^[0-9a-f-]{36}$/);
      assert.ok(!Number.isNaN(Date.parse(action.occurredAt)));
    }
    const [created, info, product, live] = actions;

    assert.equal(created.confirmed, true, "the creation was previewed, then confirmed");
    assert.deepEqual(created.fieldsSet, [
      "address",
      "country",
      "currency",
      "email",
      "name",
      "phone",
      "slug",
    ]);
    assert.deepEqual(created.facts, {
      country: "FR",
      currency: "EUR",
      has_address: true,
      has_coordinates: false,
      has_email: true,
      has_phone: true,
    });

    assert.equal(info.confirmed, false, "store info asks no confirmation");
    assert.deepEqual(info.fieldsSet, ["description", "latitude", "longitude"]);
    assert.deepEqual(info.fieldsCleared, ["phone"]);
    assert.deepEqual(info.facts, { has_coordinates: true });

    assert.deepEqual(product.facts, {
      has_price: true,
      has_deposit: true,
      pricing_tier_count: 1,
    });

    assert.equal(live.confirmed, true);
    assert.deepEqual(live.facts, {
      reservation_mode: "request",
      booking_mode_effective: "request",
    });

    // Each row is handed to the app once committed.
    for (const { id } of await rows("store.agentSetupAction")) assert.ok(dispatched.includes(id));

    const [{ payload: launch }] = await rows("store.launchAnalytics");
    assert.deepEqual(launch.actor, {
      credentialKind: "oauth",
      agentClient: "claude",
    });
    assert.ok(launch.setup);
    assert.equal(launch.setup.setupBy, "agent");
    assert.equal(launch.setup.createdBy, "agent");
    assert.equal(launch.setup.agentActionCount, 4, "create, info, product and the go-live");
    assert.equal(launch.setup.humanActionCount, 0);
    assert.deepEqual(launch.setup.agentClients, ["claude"]);
    assert.equal(typeof launch.setup.secondsSinceCreation, "number");

    await assertNoPersonalData();
  });

  test("a refused preview, a replay and a write once online queue nothing more", async () => {
    const store = await createStore(agent);
    const before = (await rows("store.agentSetupAction")).length;
    assert.equal(before, 1, "the preview alone queues nothing; its confirmation does");

    // The same idempotency key again: the stored answer, no second event.
    const key = { "idempotency-key": "sa-info-1", "louez-store": store.id };
    await call("settings", "updateStoreInfo", { latitude: 1, longitude: 2 }, agent, key);
    await call("settings", "updateStoreInfo", { latitude: 1, longitude: 2 }, agent, key);
    assert.equal((await rows("store.agentSetupAction")).length, before + 1);

    await goLive(agent, store.id);
    const launchedCount = (await rows("store.agentSetupAction")).length;
    await updateInfo(agent, store.id);
    const again = await goLive(agent, store.id);
    assert.equal(again.launched, false);
    assert.equal(
      (await rows("store.agentSetupAction")).length,
      launchedCount,
      "the store is online: its setup is over",
    );
  });

  test("analytics that cannot be added never fail the write", async () => {
    const { runOperation } = await import("./operations");
    const actor = {
      transport: "mcp" as const,
      isPlatformAdmin: false,
      storeId: "",
      credential: {
        kind: "oauth" as const,
        id: "sa_grant",
        clientName: "Claude",
        userId: USER,
        email: null,
        storeId: null,
        stores: null,
        scopes: null,
        confirmSensitive: false,
        bundles: null,
      },
    };
    const receipt: { operationId?: string } = {};
    const tooLong = "x".repeat(200); // longer than api_effects.store_id: the insert fails
    const result = await runOperation(
      {
        actor,
        procedure: "dashboard.stores.create",
        input: {},
        idempotencyKey: null,
        receipt,
        recordedEffects: () => ({
          storeId: tooLong,
          effects: [{ type: "store.welcomeCredits", payload: { storeId: tooLong, credits: 1 } }],
        }),
        dispatchEffects: (ids) => dispatched.push(...ids),
      },
      async () => ({ id: "sa_written" }),
    );
    assert.deepEqual(result, { id: "sa_written" });
    const [operation] = await louezDb.db
      .select({ status: louezDb.apiOperations.status })
      .from(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.id, String(receipt.operationId)));
    assert.equal(operation?.status, "succeeded", "the write's record stands");
    assert.deepEqual(await louezDb.db.select().from(louezDb.apiEffects), []);
    assert.deepEqual(dispatched, []);
  });

  // --- A human ----------------------------------------------------------------

  test("a human's setup queues no agent action, and its go-live says setup_by human", async () => {
    const store = await createStore(session);
    await updateInfo(session, store.id);
    await createProduct(session, store.id);
    await goLive(session, store.id);

    assert.deepEqual(await rows("store.agentSetupAction"), []);
    const [{ payload: launch }] = await rows("store.launchAnalytics");
    assert.deepEqual(launch.actor, {
      credentialKind: "session",
      agentClient: null,
    });
    assert.ok(launch.setup);
    assert.equal(launch.setup.setupBy, "human");
    assert.equal(launch.setup.createdBy, "human");
    assert.equal(launch.setup.agentActionCount, 0);
    assert.equal(launch.setup.humanActionCount, 4);
    assert.deepEqual(launch.setup.agentClients, []);
    await assertNoPersonalData();
  });

  // --- Both -------------------------------------------------------------------

  test("an agent's store a human finishes and launches is set up by both", async () => {
    const store = await createStore(agent);
    await updateInfo(session, store.id);
    await createProduct(agent, store.id);
    await goLive(session, store.id);

    const actions = (await rows("store.agentSetupAction")).map((row) => row.payload.procedure);
    assert.deepEqual(actions, ["stores.create", "products.create"]);

    const [{ payload: launch }] = await rows("store.launchAnalytics");
    assert.equal(launch.actor?.credentialKind, "session");
    assert.ok(launch.setup);
    assert.equal(launch.setup.setupBy, "mixed");
    assert.equal(launch.setup.createdBy, "agent");
    assert.equal(launch.setup.agentActionCount, 2);
    assert.equal(launch.setup.humanActionCount, 2);
    assert.deepEqual(launch.setup.agentClients, ["claude"]);

    const [{ payload: creation }] = (await rows("store.agentSetupAction")).slice(0, 1);
    assert.equal(creation.procedure, "stores.create");
    const saved = await louezDb.db
      .select({ payload: louezDb.apiEffects.payload })
      .from(louezDb.apiEffects)
      .where(orm.eq(louezDb.apiEffects.type, "store.creationAnalytics"));
    const infoSaved = saved
      .map((row) => row.payload as unknown as ApiEffectPayloads["store.creationAnalytics"])
      .find((payload) => payload.event === "store_info_saved");
    assert.ok(infoSaved);
    assert.equal(infoSaved.properties.store_created_by, "agent");
    assert.equal(infoSaved.properties.credential_kind, "oauth");
    assert.equal(infoSaved.properties.agent_client, "claude");
    await assertNoPersonalData();
  });
});
