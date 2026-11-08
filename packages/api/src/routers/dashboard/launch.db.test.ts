import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { LaunchChecklistView } from "../../contracts/launch";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "launch-test-secret";
process.env.NODE_ENV = "test";
// Billing marks and the card gate work only with the billing service on.
process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

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

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@ln.test` } } : null;
        },
      },
    },
  },
});

// The launch checklist and going live, end to end through `call()`: the
// dashboard's session and an agent's API key, on the database.

const OWNER = "ln_owner_user_000001";
const MEMBER = "ln_member_user_00001";
const STORE = "ln_store_a_000000001";
const OTHER_STORE = "ln_store_b_000000001";
const STOREFRONT = "https://ln-brest-surf.louez.test";
/** What stores.create leaves: payment mode, a country, a currency, the default hours. */
const SETTINGS = {
  reservationMode: "payment",
  advanceNoticeMinutes: 60,
  currency: "EUR",
  country: "FR",
  timezone: "Europe/Paris",
} as const;

describe("launch procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let router: typeof import("./stores").dashboardStoresRouter;

  const events: ApiEvent[] = [];
  const dispatched: string[][] = [];
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: (ids: readonly string[]) => {
      dispatched.push([...ids]);
    },
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: (event: ApiEvent) => {
      events.push(event);
    },
  };

  before(async () => {
    database = await createTestDatabase("api_launch");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    ({ dashboardStoresRouter: router } = await import("./stores"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@ln.test" },
      { id: MEMBER, email: "member@ln.test" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    events.length = 0;
    dispatched.length = 0;
    const { db } = louezDb;
    for (const table of [
      louezDb.billingSyncQueue,
      louezDb.billingPolicies,
      louezDb.apiEffects,
      louezDb.storeLocations,
      louezDb.reservations,
      louezDb.products,
      louezDb.categories,
      louezDb.stores,
    ]) {
      await db.delete(table);
    }
    // A store as an agent leaves it after stores.create: offline, nothing else set.
    await db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "Brest Surf", slug: "ln-brest-surf", settings: SETTINGS },
      { id: OTHER_STORE, userId: OWNER, name: "Other", slug: "ln-other", settings: SETTINGS },
    ]);
  });

  // --- Callers --------------------------------------------------------------

  function session(userId = OWNER, store = STORE, extra: Record<string, string> = {}) {
    return {
      headers: new Headers({
        [SESSION_HEADER]: userId,
        cookie: `louez_active_store=${store}`,
        ...extra,
      }),
      transport: "rpc" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    };
  }

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const agent: Permissions = {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "write",
  };

  async function apiKey(
    options: { permissions?: Permissions; storeId?: string; userId?: string } = {},
  ) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: options.storeId ?? STORE,
      userId: options.userId ?? OWNER,
      name: "Launch agent",
      permissions: options.permissions ?? agent,
    });
    return (extra: Record<string, string> = {}) => ({
      headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
      transport: "mcp" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    });
  }

  type Router = typeof router;
  type Client = RouterClient<Router>;

  function run<K extends keyof Router>(
    name: K,
    input: Parameters<Client[K]>[0],
    context: BaseContext,
  ): ReturnType<Client[K]> {
    const client = orpc.createRouterClient(router, {
      context,
      path: ["dashboard", "stores"],
    }) as Client;
    const call = client[name] as (input: Parameters<Client[K]>[0]) => ReturnType<Client[K]>;
    return call(input);
  }

  async function rejects(promise: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `expected ${code}, the call succeeded`);
    const { data, code: httpCode } = caught as { code?: string; data?: { code?: string } };
    assert.equal(data?.code ?? httpCode, code, String(caught));
    return caught as { data: { code: string; details?: Record<string, unknown> } };
  }

  const tokenOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
    (refusal.data.details as { confirmationToken: string }).confirmationToken;

  const statuses = (checklist: Pick<LaunchChecklistView, "items">) =>
    Object.fromEntries(checklist.items.map((item) => [item.key, item.status]));

  async function storeRow(storeId = STORE) {
    const [row] = await louezDb.db
      .select({
        settings: louezDb.stores.settings,
        onboardingCompleted: louezDb.stores.onboardingCompleted,
      })
      .from(louezDb.stores)
      .where(orm.eq(louezDb.stores.id, storeId));
    return row;
  }

  async function effects(storeId = STORE) {
    const rows = await louezDb.db
      .select({ type: louezDb.apiEffects.type, payload: louezDb.apiEffects.payload })
      .from(louezDb.apiEffects)
      .where(orm.eq(louezDb.apiEffects.storeId, storeId))
      .orderBy(louezDb.apiEffects.seq);
    return rows;
  }

  async function product(
    id: string,
    values: { price?: string; status?: "active" | "draft" | "archived"; storeId?: string } = {},
  ) {
    await louezDb.db.insert(louezDb.products).values({
      id,
      storeId: values.storeId ?? STORE,
      name: `Board ${id}`,
      price: values.price ?? "25.00",
      pricingMode: "day",
      status: values.status ?? "active",
    });
  }

  async function setStore(values: Partial<typeof louezDb.stores.$inferInsert>, storeId = STORE) {
    await louezDb.db.update(louezDb.stores).set(values).where(orm.eq(louezDb.stores.id, storeId));
  }

  // --- The checklist --------------------------------------------------------

  test("a new store's checklist: what is missing, why, and the tools that fix it", async () => {
    const checklist = await run("getLaunchChecklist", {}, session());
    assert.equal(checklist.storeId, STORE);
    assert.equal(checklist.online, false);
    assert.equal(checklist.canGoLive, true);
    assert.deepEqual(checklist.blocking, []);
    assert.equal(checklist.storefrontUrl, STOREFRONT);
    assert.deepEqual(statuses(checklist), {
      storeInfo: "done",
      contact: "missing",
      products: "missing",
      categories: "optional",
      pickup: "missing",
      businessHours: "done",
      terms: "missing",
      legalNotice: "missing",
      onlinePayments: "missing",
      billing: "done",
      branding: "optional",
    });
    assert.deepEqual(checklist.bookingMode, {
      intended: "payment",
      effective: "request",
      stripeChargeable: false,
    });
    assert.deepEqual(checklist.milestones, {
      firstReservation: false,
      firstCompletedReservation: false,
    });
    const products = checklist.items.find((item) => item.key === "products");
    assert.ok(products?.tools.includes("products_create"));
    assert.equal(products?.required, false);
    assert.equal(products?.links.dashboard, `${TEST_APP_URL}/dashboard/products?store=${STORE}`);
    // Only the user connects Stripe: no tool, the dashboard link.
    const payments = checklist.items.find((item) => item.key === "onlinePayments");
    assert.deepEqual(payments?.tools, ["settings_update_reservation_rules"]);
    assert.match(payments?.why ?? "", /Stripe is not connected/);
    // Offline: the store's links hold no storefront.
    assert.deepEqual(checklist.links, { dashboard: `${TEST_APP_URL}/dashboard?store=${STORE}` });

    // An API key reads the same checklist.
    const key = await apiKey({ permissions: { ...agent, settings: "read" } });
    assert.deepEqual(await run("getLaunchChecklist", {}, key()), checklist);
  });

  test("each item turns done on the data that fulfils it", async () => {
    await product("ln_prod_board", { price: "30.00" });
    await louezDb.db
      .insert(louezDb.categories)
      .values({ id: "ln_cat_boards", storeId: STORE, name: "Boards" });
    await setStore({
      email: "hello@ln.test",
      address: "Plage du Moulin Blanc, Brest",
      cgv: "<p>Rental terms</p>",
      legalNotice: "<p>Brest Surf SAS</p>",
      logoUrl: `https://cdn.ln.test/${STORE}/logo/logo.png`,
      stripeAccountId: "acct_ln",
      stripeChargesEnabled: true,
    });
    const checklist = await run("getLaunchChecklist", {}, session());
    for (const item of checklist.items) assert.equal(item.status, "done", item.key);
    assert.deepEqual(checklist.bookingMode, {
      intended: "payment",
      effective: "payment",
      stripeChargeable: true,
    });
  });

  test("the edges of each item", async () => {
    // A product priced zero, or not active, is nothing to book.
    await product("ln_prod_free", { price: "0.00" });
    await product("ln_prod_draft", { status: "draft" });
    // Blank HTML is no text; hours on with every day closed take no booking.
    const closed = { isOpen: false, ranges: [] };
    await setStore({
      cgv: "<p><br></p>",
      legalNotice: "<p>   </p>",
      settings: {
        ...SETTINGS,
        reservationMode: "request",
        businessHours: {
          enabled: true,
          schedule: { 0: closed, 1: closed, 2: closed, 3: closed, 4: closed, 5: closed, 6: closed },
          closurePeriods: [],
        },
        delivery: {
          enabled: false,
          multiLocationEnabled: true,
          mode: "optional",
          pricePerKm: 1,
          minimumFee: 0,
          maximumDistance: null,
          freeDeliveryThreshold: null,
        },
      },
    });
    let checklist = await run("getLaunchChecklist", {}, session());
    assert.equal(statuses(checklist).products, "missing");
    assert.equal(statuses(checklist).terms, "missing");
    assert.equal(statuses(checklist).legalNotice, "missing");
    assert.equal(statuses(checklist).businessHours, "missing");
    assert.equal(statuses(checklist).pickup, "missing");
    // Request mode needs no Stripe.
    assert.equal(statuses(checklist).onlinePayments, "optional");
    assert.deepEqual(checklist.bookingMode, {
      intended: "request",
      effective: "request",
      stripeChargeable: false,
    });

    // An active pickup point, with several points on, is where customers collect.
    await louezDb.db.insert(louezDb.storeLocations).values({
      id: "ln_loc_port",
      storeId: STORE,
      name: "Port",
      address: "Quai",
    });
    checklist = await run("getLaunchChecklist", {}, session());
    assert.equal(statuses(checklist).pickup, "done");

    // Without an address or a point, delivery is enough only once checkout
    // can deliver: it measures from the store's coordinates.
    await louezDb.db.delete(louezDb.storeLocations);
    const settings = (await storeRow())?.settings;
    const delivery = settings?.delivery;
    assert.ok(settings && delivery);
    const withDelivery = (mode: "optional" | "required" | "included") => ({
      ...settings,
      delivery: { ...delivery, enabled: true, multiLocationEnabled: false, mode },
    });
    const pickupOf = async () =>
      (await run("getLaunchChecklist", {}, session())).items.find(
        (entry) => entry.key === "pickup",
      );
    await setStore({ settings: withDelivery("optional") });
    let pickup = await pickupOf();
    assert.equal(pickup?.status, "missing");
    assert.match(pickup?.why ?? "", /delivery needs the store's coordinates/);
    await setStore({ latitude: "48.3904000", longitude: "-4.4861000" });
    assert.equal((await pickupOf())?.status, "done");

    // Delivery only, without coordinates: checkout cannot deliver and the
    // booking check refuses a pickup, address or not.
    await setStore({
      settings: withDelivery("required"),
      latitude: null,
      longitude: null,
      address: "Plage du Moulin Blanc, Brest",
    });
    pickup = await pickupOf();
    assert.equal(pickup?.status, "missing");
    assert.match(pickup?.why ?? "", /only way to get a rental.*no usable coordinates/);
    await setStore({ settings: withDelivery("included") });
    assert.equal((await pickupOf())?.status, "missing");
    // Coordinates off the map are no better than none.
    await setStore({ latitude: "123.0000000", longitude: "-4.4861000" });
    assert.equal((await pickupOf())?.status, "missing");
    await setStore({ latitude: "48.3904000", longitude: "-4.4861000" });
    assert.equal((await pickupOf())?.status, "done");
  });

  test("a free consumable is a product for the home, not a priced one for the launch", async () => {
    // A fixed-price consumable at zero: a valid product (a free map, wax).
    await louezDb.db.insert(louezDb.products).values({
      id: "ln_prod_wax",
      storeId: STORE,
      name: "Wax",
      price: "0.00",
      pricingMode: "day",
      pricingKind: "fixed",
      stockKind: "consumable",
      quantity: 50,
      status: "active",
    });
    const checklist = await run("getLaunchChecklist", {}, session());
    assert.deepEqual(checklist.catalog, { hasActiveProduct: true, hasPricedProduct: false });
    const products = checklist.items.find((entry) => entry.key === "products");
    assert.equal(products?.status, "missing");
    assert.match(products?.why ?? "", /priced at zero/);

    // The preview lists them as free, not as an empty catalog.
    const key = await apiKey();
    const refusal = await rejects(run("completeOnboarding", {}, key()), "CONFIRMATION_REQUIRED");
    const seen = (refusal.data.details as { preview: { details: { customersWillSee: string[] } } })
      .preview.details.customersWillSee;
    assert.ok(
      seen.some((line) => /free of charge/.test(line)),
      seen.join(" | "),
    );
    assert.ok(!seen.some((line) => /catalog is empty/.test(line)), seen.join(" | "));

    // With a priced product too, both hold.
    await product("ln_prod_board");
    assert.deepEqual((await run("getLaunchChecklist", {}, session())).catalog, {
      hasActiveProduct: true,
      hasPricedProduct: true,
    });
  });

  test("the preview shows the store with the booking mode it goes live with", async () => {
    const key = await apiKey();
    type Preview = {
      summary: string;
      details: {
        bookingMode: { intended: string; effective: string };
        stillMissing: Array<{ key: string }>;
        optional: Array<{ key: string }>;
      };
    };
    const previewOf = async (input: { reservationMode?: "payment" | "request" }) => {
      const refusal = await rejects(
        run("completeOnboarding", input, key()),
        "CONFIRMATION_REQUIRED",
      );
      return {
        token: tokenOf(refusal),
        preview: (refusal.data.details as { preview: Preview }).preview,
      };
    };

    // A payment-mode store without Stripe that goes live taking requests:
    // online payments are optional then, not missing.
    const toRequest = await previewOf({ reservationMode: "request" });
    assert.equal(toRequest.preview.details.bookingMode.intended, "request");
    assert.ok(
      !toRequest.preview.details.stillMissing.some((entry) => entry.key === "onlinePayments"),
    );
    assert.ok(toRequest.preview.details.optional.some((entry) => entry.key === "onlinePayments"));
    // Left out, the mode is the store's: payment without Stripe, so missing.
    const kept = await previewOf({});
    assert.ok(kept.preview.details.stillMissing.some((entry) => entry.key === "onlinePayments"));

    // A request-mode store going live in payment mode: missing, not optional.
    await setStore({ settings: { ...SETTINGS, reservationMode: "request" } });
    const toPayment = await previewOf({ reservationMode: "payment" });
    assert.equal(toPayment.preview.details.bookingMode.intended, "payment");
    assert.ok(
      toPayment.preview.details.stillMissing.some((entry) => entry.key === "onlinePayments"),
    );
    assert.ok(!toPayment.preview.details.optional.some((entry) => entry.key === "onlinePayments"));

    // The token is bound to that view: confirmed as it is, the store goes live in that mode.
    const done = await run(
      "completeOnboarding",
      { reservationMode: "payment" },
      key({ "louez-confirmation": toPayment.token }),
    );
    assert.equal(done.launched, true);
    assert.equal(done.bookingMode.intended, "payment");
    assert.equal((await storeRow())?.settings?.reservationMode, "payment");
  });

  test("a store without its country or currency cannot go live", async () => {
    await setStore({ settings: { reservationMode: "payment", advanceNoticeMinutes: 60 } });
    const checklist = await run("getLaunchChecklist", {}, session());
    assert.equal(checklist.canGoLive, false);
    assert.deepEqual(checklist.blocking, ["storeInfo"]);
    const info = checklist.items.find((item) => item.key === "storeInfo");
    assert.equal(info?.status, "missing");
    assert.equal(info?.required, true);
    assert.match(info?.why ?? "", /has no country and no currency/);

    const refusal = await rejects(run("completeOnboarding", {}, session()), "STORE_NOT_READY");
    const blocking = (refusal.data.details as { blocking: Array<{ key: string; tools: string[] }> })
      .blocking;
    assert.deepEqual(
      blocking.map((item) => item.key),
      ["storeInfo"],
    );
    assert.ok(blocking[0]?.tools.includes("settings_update_company"));
    // Nothing was written, nothing queued.
    assert.equal((await storeRow())?.onboardingCompleted, false);
    assert.deepEqual(await effects(), []);
    assert.deepEqual(events, []);
  });

  test("billing that stops new bookings shows as blocked, read-only, and does not stop the launch", async () => {
    const now = new Date(Date.now() - 60_000);
    const body = {
      schema: "louez.billing.policy/1",
      storeId: STORE,
      version: 1,
      effectiveFrom: now.toISOString(),
      issuedAt: now.toISOString(),
      newStoresCreatedFrom: null,
      offerKey: "test-offer",
      invoicing: "louez_legacy",
      currency: "EUR",
      applicationFee: { kind: "none" },
      marketplaceFeeMinor: 0,
      reservations: { allowed: false, reason: "payment_overdue" },
      notice: null,
      stripeCustomerId: null,
      labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
    };
    await louezDb.db
      .insert(louezDb.billingPolicies)
      .values({ storeId: STORE, version: 1, effectiveFrom: now, body });

    const checklist = await run("getLaunchChecklist", {}, session());
    const billing = checklist.items.find((item) => item.key === "billing");
    assert.equal(billing?.status, "blocked");
    assert.deepEqual(billing?.tools, []);
    assert.match(billing?.why ?? "", /payment overdue/);
    assert.equal(
      billing?.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/billing?store=${STORE}`,
    );
    assert.equal(checklist.canGoLive, true);
    // The other store's billing is its own.
    const other = await run("getLaunchChecklist", {}, session(OWNER, OTHER_STORE));
    assert.equal(statuses(other).billing, "done");
  });

  test("a store's checklist counts its own rows only", async () => {
    await product("ln_prod_other", { storeId: OTHER_STORE });
    await louezDb.db
      .insert(louezDb.categories)
      .values({ id: "ln_cat_other", storeId: OTHER_STORE, name: "Elsewhere" });
    const mine = await run("getLaunchChecklist", {}, session());
    assert.equal(statuses(mine).products, "missing");
    assert.equal(statuses(mine).categories, "optional");
    const theirs = await run("getLaunchChecklist", {}, session(OWNER, OTHER_STORE));
    assert.equal(statuses(theirs).products, "done");
    // A key of the other store reads the other store, whatever it asks.
    const otherKey = await apiKey({ storeId: OTHER_STORE });
    assert.equal((await run("getLaunchChecklist", {}, otherKey())).storeId, OTHER_STORE);
    // Going live there leaves this store offline.
    await run("completeOnboarding", {}, session(OWNER, OTHER_STORE));
    assert.equal((await storeRow())?.onboardingCompleted, false);
    assert.equal((await storeRow(OTHER_STORE))?.onboardingCompleted, true);
  });

  test("rights: reading needs settings read; going live needs settings write and manage_settings", async () => {
    const none = await apiKey({ permissions: { ...agent, settings: "none" } });
    await rejects(run("getLaunchChecklist", {}, none()), "PERMISSION_DENIED");
    const reader = await apiKey({ permissions: { ...agent, settings: "read" } });
    await rejects(run("completeOnboarding", {}, reader()), "PERMISSION_DENIED");
    // A member reads the checklist but cannot launch the store, nor can their key.
    assert.equal((await run("getLaunchChecklist", {}, session(MEMBER))).storeId, STORE);
    await rejects(run("completeOnboarding", {}, session(MEMBER)), "PERMISSION_DENIED");
    const memberKey = await apiKey({ userId: MEMBER });
    await rejects(run("completeOnboarding", {}, memberKey()), "PERMISSION_DENIED");
    // Without reservations read, the first bookings are left out.
    const noReservations = await apiKey({ permissions: { ...agent, reservations: "none" } });
    assert.equal((await run("getLaunchChecklist", {}, noReservations())).milestones, null);
    assert.equal((await storeRow())?.onboardingCompleted, false);
  });

  // --- Going live -----------------------------------------------------------

  test("going live from the dashboard: the flag, the defaults, the mark, the outbox, the links", async () => {
    await setStore({ settings: { ...SETTINGS, minRentalMinutes: 120 } });
    const result = await run("completeOnboarding", { reservationMode: "request" }, session());
    assert.equal(result.launched, true);
    assert.equal(result.online, true);
    assert.equal(result.storefrontUrl, STOREFRONT);
    assert.deepEqual(result.links, {
      dashboard: `${TEST_APP_URL}/dashboard?store=${STORE}`,
      storefront: STOREFRONT,
    });
    assert.deepEqual(result.bookingMode, {
      intended: "request",
      effective: "request",
      stripeChargeable: false,
    });
    assert.ok(result.remaining.some((item) => item.key === "products"));
    assert.ok(result.remaining.every((item) => item.status !== "done"));

    const row = await storeRow();
    assert.equal(row?.onboardingCompleted, true);
    // The onboarding's defaults fill what the store lacks; what it has stays.
    assert.equal(row?.settings?.reservationMode, "request");
    assert.equal(row?.settings?.minRentalMinutes, 120);
    assert.equal(row?.settings?.maxRentalMinutes, null);
    assert.equal(row?.settings?.turnoverBufferMinutes, 0);
    assert.equal(row?.settings?.advanceNoticeMinutes, 60);
    assert.equal(row?.settings?.currency, "EUR");

    // onboardingCompleted is in the billing snapshot.
    const marks = await louezDb.db
      .select({
        type: louezDb.billingSyncQueue.aggregateType,
        id: louezDb.billingSyncQueue.aggregateId,
      })
      .from(louezDb.billingSyncQueue);
    assert.deepEqual(marks, [{ type: "store", id: STORE }]);

    // The platform's notice on each channel, and the analytics event, then dispatched.
    const queued = await effects();
    assert.deepEqual(
      queued.map((effect) => effect.type),
      ["store.launchNotification", "store.launchNotification", "store.launchAnalytics"],
    );
    assert.deepEqual(
      queued.slice(0, 2).map((effect) => (effect.payload as { channel: string }).channel),
      ["discord", "fromhello"],
    );
    const analytics = queued[2]?.payload as Record<string, unknown>;
    assert.equal(analytics.ownerUserId, OWNER);
    assert.equal(analytics.reservationMode, "request");
    assert.equal(analytics.transport, "rpc");
    assert.equal(typeof analytics.eventUuid, "string");
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0]?.length, 3);
    assert.deepEqual(
      events.map((event) => event.type),
      ["store.launched"],
    );

    // The checklist and the links follow.
    const checklist = await run("getLaunchChecklist", {}, session());
    assert.equal(checklist.online, true);
    assert.equal(checklist.links.storefront, STOREFRONT);
  });

  test("going live twice is a no-op that answers with the URL; a replayed key returns the first answer", async () => {
    const key = await apiKey();
    const confirmed = await rejects(
      run("completeOnboarding", {}, key({ "idempotency-key": "live-1" })),
      "CONFIRMATION_REQUIRED",
    );
    const first = await run(
      "completeOnboarding",
      {},
      key({ "idempotency-key": "live-2", "louez-confirmation": tokenOf(confirmed) }),
    );
    assert.equal(first.launched, true);
    assert.equal((await effects()).length, 3);

    // The same key again: the stored answer, nothing run.
    const replay = key({ "idempotency-key": "live-2", "louez-confirmation": tokenOf(confirmed) });
    const replayed = await run("completeOnboarding", {}, replay);
    assert.deepEqual(replayed, first);
    assert.equal(replay.receipt.replayed, true);

    // A new call on a live store: no confirmation, no effects, the URL.
    const again = await run("completeOnboarding", {}, key());
    assert.equal(again.launched, false);
    assert.equal(again.storefrontUrl, first.storefrontUrl);
    assert.equal(again.links.storefront, first.links.storefront);
    const fromSession = await run("completeOnboarding", { reservationMode: "payment" }, session());
    assert.equal(fromSession.launched, false);
    assert.equal((await effects()).length, 3);
    assert.deepEqual(
      events.map((event) => event.type),
      ["store.launched"],
    );
  });

  test("a live store's booking mode changes when the wizard sends another one, without a second launch", async () => {
    await run("completeOnboarding", { reservationMode: "payment" }, session());
    events.length = 0;
    // The wizard's payment step again, after a Stripe detour: the user picks requests.
    const changed = await run("completeOnboarding", { reservationMode: "request" }, session());
    assert.equal(changed.launched, false);
    assert.equal(changed.bookingMode.intended, "request");
    assert.equal((await storeRow())?.settings?.reservationMode, "request");
    assert.equal((await effects()).length, 3);
    assert.deepEqual(events, [
      {
        type: "store.settingsUpdated",
        store: { id: STORE, name: "Brest Surf", slug: "ln-brest-surf", ownerUserId: OWNER },
        section: "reservationRules",
      },
    ]);
    // An agent confirms that change.
    const key = await apiKey();
    const refusal = await rejects(
      run("completeOnboarding", { reservationMode: "payment" }, key()),
      "CONFIRMATION_REQUIRED",
    );
    assert.match(
      (refusal.data.details as { preview: { summary: string } }).preview.summary,
      /online already.*from request to payment/,
    );
    assert.equal((await storeRow())?.settings?.reservationMode, "request");
  });

  test("two launches at once: one goes live, the other finds it live", async () => {
    const results = await raceOnLockedRow(database, { table: "stores", id: STORE }, [
      () => run("completeOnboarding", {}, session()),
      () => run("completeOnboarding", {}, session()),
    ]);
    assert.deepEqual(results.map((result) => result.launched).sort(), [false, true]);
    assert.equal((await effects()).length, 3);
    assert.deepEqual(
      events.map((event) => event.type),
      ["store.launched"],
    );
  });

  test("an agent goes live through a preview; a product deactivated since voids its token", async () => {
    await product("ln_prod_board");
    const key = await apiKey();
    const refusal = await rejects(run("completeOnboarding", {}, key()), "CONFIRMATION_REQUIRED");
    const preview = (
      refusal.data.details as {
        preview: {
          summary: string;
          details: {
            storefrontUrl: string;
            bookingMode: { intended: string; effective: string };
            customersWillSee: string[];
            stillMissing: Array<{ key: string }>;
            optional: Array<{ key: string }>;
          };
        };
      }
    ).preview;
    assert.match(preview.summary, /Put "Brest Surf" online at https:\/\/ln-brest-surf/);
    assert.equal(preview.details.storefrontUrl, STOREFRONT);
    assert.deepEqual(preview.details.bookingMode, {
      intended: "payment",
      effective: "request",
      stripeChargeable: false,
    });
    assert.ok(preview.details.customersWillSee.some((line) => /booking requests/.test(line)));
    assert.ok(
      preview.details.customersWillSee.some((line) => /listed with their prices/.test(line)),
    );
    assert.ok(!preview.details.stillMissing.some((item) => item.key === "products"));
    assert.ok(preview.details.stillMissing.some((item) => item.key === "terms"));
    assert.deepEqual(
      preview.details.optional.map((item) => item.key),
      ["categories", "branding"],
    );
    // The preview changed nothing.
    assert.equal((await storeRow())?.onboardingCompleted, false);

    // The board goes back to draft before the agent confirms: the catalog it
    // showed is not the one that would go live.
    await louezDb.db
      .update(louezDb.products)
      .set({ status: "draft" })
      .where(orm.eq(louezDb.products.id, "ln_prod_board"));
    await rejects(
      run("completeOnboarding", {}, key({ "louez-confirmation": tokenOf(refusal) })),
      "CONFIRMATION_INVALID",
    );
    assert.equal((await storeRow())?.onboardingCompleted, false);
    assert.deepEqual(await effects(), []);

    // A new preview, confirmed as it is: live.
    const fresh = await rejects(run("completeOnboarding", {}, key()), "CONFIRMATION_REQUIRED");
    const done = await run("completeOnboarding", {}, key({ "louez-confirmation": tokenOf(fresh) }));
    assert.equal(done.launched, true);
    const analytics = (await effects()).at(-1)?.payload as { transport?: string } | undefined;
    assert.equal(analytics?.transport, "mcp");
    // Sent again, the spent token launches nothing: the store is live.
    const again = await run(
      "completeOnboarding",
      {},
      key({ "louez-confirmation": tokenOf(fresh) }),
    );
    assert.equal(again.launched, false);
    assert.equal((await effects()).length, 3);
  });

  test("a confirmed launch whose store lost its currency meanwhile is refused as not ready", async () => {
    const key = await apiKey();
    const refusal = await rejects(run("completeOnboarding", {}, key()), "CONFIRMATION_REQUIRED");
    await setStore({
      settings: { reservationMode: "payment", advanceNoticeMinutes: 60, country: "FR" },
    });
    await rejects(
      run("completeOnboarding", {}, key({ "louez-confirmation": tokenOf(refusal) })),
      "STORE_NOT_READY",
    );
    assert.equal((await storeRow())?.onboardingCompleted, false);
  });
});
