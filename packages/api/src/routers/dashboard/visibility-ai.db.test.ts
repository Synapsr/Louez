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
    await db.delete(louezDb.storefrontEvents);
    await db.delete(louezDb.reservations);
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

  const product = (
    id: string,
    values: { images?: string[]; price?: string; status?: "active" | "draft" },
  ) => ({
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
    const view = (
      sessionId: string,
      aiAssistant: string | null,
      createdAt: Date,
      storeId = STORE,
    ) => ({
      storeId,
      sessionId,
      page: "home" as const,
      aiAssistant,
      createdAt,
    });
    await louezDb.db
      .insert(louezDb.pageViews)
      .values([
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

  const reservation = (id: string, isTest = false) => ({
    id,
    storeId: STORE,
    customerId: "ai_customer_00000001",
    number: id.slice(-6),
    startDate: RECENT,
    endDate: NOW,
    subtotalAmount: "10.00",
    depositAmount: "0.00",
    totalAmount: "10.00",
    isTest,
  });

  const checkout = (sessionId: string, reservationId: string | null, createdAt = RECENT) => ({
    storeId: STORE,
    sessionId,
    eventType: "checkout_completed" as const,
    metadata: reservationId ? { reservationId } : { itemCount: 1 },
    createdAt,
  });

  const aiView = (sessionId: string, aiAssistant: string | null, createdAt = RECENT) => ({
    storeId: STORE,
    sessionId,
    page: "product" as const,
    aiAssistant,
    createdAt,
  });

  test("a booking counts when made in a visit from an assistant, test ones and others aside", async () => {
    const A = "00000000-0000-4000-8000-0000000000a1";
    const B = "00000000-0000-4000-8000-0000000000b1";
    const DIRECT = "00000000-0000-4000-8000-0000000000c1";
    await louezDb.db
      .insert(louezDb.pageViews)
      .values([aiView(A, "chatgpt"), aiView(B, "perplexity"), aiView(DIRECT, null)]);
    await louezDb.db
      .insert(louezDb.reservations)
      .values([
        reservation("ai_resa_chatgpt_00001"),
        reservation("ai_resa_test_00000001", true),
        reservation("ai_resa_direct_000001"),
      ]);
    await louezDb.db.insert(louezDb.storefrontEvents).values([
      checkout(A, "ai_resa_chatgpt_00001"),
      // Reported twice: counted once.
      checkout(A, "ai_resa_chatgpt_00001"),
      // A test reservation, and an event that names no reservation: not counted.
      checkout(B, "ai_resa_test_00000001"),
      checkout(B, null),
      // A visit no assistant sent.
      checkout(DIRECT, "ai_resa_direct_000001"),
    ]);

    const bookings = await service.readAiBookings(STORE, OLD, NOW);
    assert.deepEqual(
      bookings.map((booking) => [booking.reservationId, booking.assistant]),
      [["ai_resa_chatgpt_00001", "chatgpt"]],
    );
    assert.equal((await service.getAiVisibility(STORE, NOW)).bookings.total, 1);
  });

  test("the AI sources view counts the period, the one before, and every visit", async () => {
    const view = (sessionId: string, aiAssistant: string | null, createdAt: Date) =>
      aiView(sessionId, aiAssistant, createdAt);
    await louezDb.db.insert(louezDb.pageViews).values([
      view("00000000-0000-4000-8000-000000000d01", "chatgpt", RECENT),
      view("00000000-0000-4000-8000-000000000d02", "claude", RECENT),
      view("00000000-0000-4000-8000-000000000d03", null, RECENT),
      // In the 7 days before the period.
      view("00000000-0000-4000-8000-000000000d04", "chatgpt", new Date("2026-11-08T12:00:00Z")),
    ]);
    await service.recordAiCrawl({
      storeId: STORE,
      crawler: "gptbot",
      resource: "llms_txt",
      now: RECENT,
    });

    const traffic = await service.getAiTraffic(STORE, "7d", NOW);
    assert.equal(traffic.granularity, "day");
    assert.equal(traffic.series.length, 7);
    assert.deepEqual(traffic.visits, { total: 2, previous: 1, all: 3 });
    assert.equal(
      traffic.series.reduce((sum, point) => sum + point.visits, 0),
      2,
    );
    assert.deepEqual(traffic.crawls, { total: 1, llmsTxt: 1 });
    assert.deepEqual(
      traffic.byAssistant.map((row) => [row.assistant, row.visits, row.hits]),
      [
        ["chatgpt", 1, 1],
        ["claude", 1, 0],
      ],
    );
  });

  test("the procedure answers a store with the feature, and refuses one without", async () => {
    const view = await orpc.call(router.getAi, {}, { context: session(true) });
    assert.equal(view.readiness.length, 4);

    const traffic = await orpc.call(
      router.getAiTraffic,
      { period: "30d" },
      { context: session(true) },
    );
    assert.equal(traffic.period, "30d");

    for (const included of [false, undefined]) {
      const calls = [
        () => orpc.call(router.getAi, {}, { context: session(included) }),
        () => orpc.call(router.getAiTraffic, { period: "7d" }, { context: session(included) }),
      ];
      for (const call of calls) {
        await assert.rejects(
          call(),
          (error: { data?: { code?: string } }) =>
            error.data?.code === "AI_VISIBILITY_NOT_INCLUDED",
        );
      }
    }
  });
});
