import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls } from "../../platform/test-urls";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@ai.test` } } : null;
        },
      },
    },
  },
});

// « Être trouvé par les IA »: the readiness read from the store, the visits
// assistants sent, the crawler reads counted per day, and the entitlement.

const OWNER = "ai_owner_user_000001";
const STORE = "ai_store_a_000000001";
const OTHER_STORE = "ai_store_b_000000001";
const NOW = new Date("2026-11-18T12:00:00Z");
const RECENT = new Date("2026-11-17T12:00:00Z");
const OLD = new Date("2026-10-01T12:00:00Z");

describe("AI visibility (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let service: typeof import("../../services/ai-visibility");
  let router: typeof import("./visibility").dashboardVisibilityRouter;

  const ports = (included: boolean | undefined) => ({
    planFeatures: async () => ({ apiAccess: true }),
    ...(included !== undefined && { aiVisibility: async () => included }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: {} as never,
    urls: createTestUrls(),
    afterCommit: () => {},
  });

  const session = (included: boolean | undefined) => ({
    headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${STORE}` }),
    transport: "rpc" as const,
    ports: ports(included),
    receipt: {},
  });

  before(async () => {
    database = await createTestDatabase("api_ai_visibility");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    service = await import("../../services/ai-visibility");
    ({ dashboardVisibilityRouter: router } = await import("./visibility"));

    await louezDb.db.insert(louezDb.users).values([{ id: OWNER, email: "owner@ai.test" }]);
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values([{ storeId: STORE, userId: OWNER, role: "owner" }]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    const { db } = louezDb;
    await db.delete(louezDb.storeAiCrawls);
    await db.delete(louezDb.pageViews);
    await db.delete(louezDb.products);
    await db.delete(louezDb.stores);
    await db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Vélos du Port",
      slug: "ai-velos-du-port",
      description: "<p>Location de vélos électriques et de kayaks sur le port de Vannes.</p>",
      address: null,
      settings: { reservationMode: "payment", advanceNoticeMinutes: 60 },
      onboardingCompleted: true,
    });
  });

  const product = (id: string, values: { images?: string[]; price?: string; status?: "active" | "draft" }) => ({
    id,
    storeId: STORE,
    name: id,
    price: values.price ?? "25.00",
    images: values.images ?? [],
    status: values.status ?? ("active" as const),
  });

  test("readiness reads the store and counts active products with a photo and a price", async () => {
    await louezDb.db.insert(louezDb.products).values([
      product("ai_prod_complete_0001", { images: ["https://files.test/a.png"] }),
      product("ai_prod_no_photo_0001", {}),
      product("ai_prod_free_00000001", { images: ["https://files.test/b.png"], price: "0.00" }),
      // A draft is not online: not counted.
      product("ai_prod_draft_0000001", { status: "draft" }),
    ]);

    const { readiness } = await service.getAiVisibility(STORE, NOW);
    assert.deepEqual(
      readiness.map((item) => [item.key, item.ready]),
      [
        ["description", true],
        ["address", false],
        ["businessHours", false],
        ["products", false],
      ],
    );
    assert.deepEqual(readiness.find((item) => item.key === "products")?.count, {
      ready: 1,
      total: 3,
    });
  });

  test("visits count the sessions each assistant sent, in the window, for this store", async () => {
    const view = (sessionId: string, aiAssistant: string | null, createdAt: Date, storeId = STORE) => ({
      storeId,
      sessionId,
      page: "home" as const,
      aiAssistant,
      createdAt,
    });
    await louezDb.db.insert(louezDb.pageViews).values([
      view("00000000-0000-4000-8000-000000000001", "chatgpt", RECENT),
      view("00000000-0000-4000-8000-000000000001", "chatgpt", RECENT),
      view("00000000-0000-4000-8000-000000000002", "perplexity", RECENT),
      view("00000000-0000-4000-8000-000000000003", null, RECENT),
      view("00000000-0000-4000-8000-000000000004", "chatgpt", OLD),
      view("00000000-0000-4000-8000-000000000005", "chatgpt", RECENT, OTHER_STORE),
    ]);

    const { visits } = await service.getAiVisibility(STORE, NOW);
    assert.deepEqual(visits, {
      total: 2,
      byAssistant: [
        { assistant: "chatgpt", visits: 1 },
        { assistant: "perplexity", visits: 1 },
      ],
    });
  });

  test("a crawl is one row per store, day, crawler and resource, its hits incremented", async () => {
    const record = (crawler: string, resource: "page" | "llms_txt", now: Date, storeId = STORE) =>
      service.recordAiCrawl({ storeId, crawler, resource, now });
    await record("gptbot", "page", RECENT);
    await record("gptbot", "page", RECENT);
    await record("gptbot", "page", RECENT);
    await record("claudebot", "llms_txt", RECENT);
    await record("gptbot", "page", OLD);
    await record("gptbot", "page", RECENT, OTHER_STORE);

    const rows = await louezDb.db.select().from(louezDb.storeAiCrawls);
    assert.equal(rows.length, 4);

    const { crawls } = await service.getAiVisibility(STORE, NOW);
    assert.deepEqual(crawls, {
      total: 4,
      llmsTxt: 1,
      byAssistant: [
        { assistant: "chatgpt", hits: 3 },
        { assistant: "claude", hits: 1 },
      ],
    });
  });

  test("the procedure answers a store with the feature, and refuses one without", async () => {
    const view = await orpc.call(router.getAi, {}, { context: session(true) });
    assert.equal(view.readiness.length, 4);

    for (const included of [false, undefined]) {
      await assert.rejects(
        orpc.call(router.getAi, {}, { context: session(included) }),
        (error: { data?: { code?: string } }) => error.data?.code === "AI_VISIBILITY_NOT_INCLUDED",
      );
    }
  });
});
