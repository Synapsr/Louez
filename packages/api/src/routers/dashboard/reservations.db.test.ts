import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "reservations-test-secret";
process.env.NODE_ENV = "test";

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
          return id ? { user: { id, email: `${id}@rs.test` } } : null;
        },
      },
    },
  },
});

// Reservation follow-up through its procedures, on the database: the
// dashboard's session, and agents' API keys with their rights.

const OWNER = "rs_owner_user_000001";
const STORE = "rs_store_a_000000001";
const OTHER_STORE = "rs_store_b_000000001";
const CUSTOMER = "rs_customer_00000001";
const OTHER_CUSTOMER = "rs_customer_00000002";

const START = new Date("2030-06-01T09:00:00Z");
const END = new Date("2030-06-03T09:00:00Z");

describe("reservation follow-up procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let router: typeof import("./reservations").dashboardReservationsRouter;
  let searchRouter: typeof import("./search").dashboardSearchRouter;

  const events: ApiEvent[] = [];
  const feeEffects: unknown[][] = [];
  const contracts: string[] = [];
  const dispatched: string[] = [];
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: (event: ApiEvent) => {
      events.push(event);
    },
    runReservationEffects: async (effects: readonly unknown[]) => {
      feeEffects.push([...effects]);
    },
    insurance: {
      createContract: async (id: string) => {
        contracts.push(`create:${id}`);
        return null;
      },
      cancelContract: async (id: string) => {
        contracts.push(`cancel:${id}`);
      },
    },
    newStores: createTestNewStores(),
    dispatchEffects: (ids: readonly string[]) => {
      dispatched.push(...ids);
    },
  };

  const settings = {
    reservationMode: "request" as const,
    currency: "EUR",
    pendingBlocksAvailability: false,
    advanceNoticeMinutes: 0,
    minRentalMinutes: 0,
    turnoverBufferMinutes: 0,
  };

  before(async () => {
    database = await createTestDatabase("api_reservations");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    ({ dashboardReservationsRouter: router } = await import("./reservations"));
    ({ dashboardSearchRouter: searchRouter } = await import("./search"));

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@rs.test" });
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "A store", slug: "rs-store-a", settings },
      { id: OTHER_STORE, userId: OWNER, name: "B store", slug: "rs-store-b", settings },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
    ]);
    await louezDb.db.insert(louezDb.customers).values([
      {
        id: CUSTOMER,
        storeId: STORE,
        email: "ada@rs.test",
        firstName: "Ada",
        lastName: "Lovelace",
        address: "1 Analytical Way",
      },
      {
        id: OTHER_CUSTOMER,
        storeId: OTHER_STORE,
        email: "grace@rs.test",
        firstName: "Grace",
        lastName: "Hopper",
      },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    events.length = 0;
    feeEffects.length = 0;
    contracts.length = 0;
    dispatched.length = 0;
    await louezDb.db.delete(louezDb.apiEffects);
    await louezDb.db.delete(louezDb.apiOperations);
    await louezDb.db.delete(louezDb.apiConfirmations);
    await louezDb.db.delete(louezDb.payments);
    await louezDb.db.delete(louezDb.reservationActivity);
    await louezDb.db.delete(louezDb.reservationItems);
    await louezDb.db.delete(louezDb.reservations);
    await louezDb.db.delete(louezDb.products);
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings, customerNotificationSettings: null })
      .where(orm.eq(louezDb.stores.id, STORE));
  });

  // --- Callers --------------------------------------------------------------

  function session(store = STORE, extra: Record<string, string> = {}) {
    return {
      headers: new Headers({
        [SESSION_HEADER]: OWNER,
        cookie: `louez_active_store=${store}`,
        ...extra,
      }),
      transport: "rpc" as const,
      ports,
      receipt: {},
    };
  }

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const everything: Permissions = {
    reservations: "write",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  };

  async function apiKey(permissions: Permissions = everything) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Reservations agent",
      permissions,
    });
    return (extra: Record<string, string> = {}) => ({
      headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
      transport: "openapi" as const,
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
      path: ["dashboard", "reservations"],
    }) as Client;
    const call = client[name] as (input: Parameters<Client[K]>[0]) => ReturnType<Client[K]>;
    return call(input);
  }

  function search(query: string, context: BaseContext) {
    const client = orpc.createRouterClient(searchRouter, {
      context,
      path: ["dashboard", "search"],
    }) as RouterClient<typeof searchRouter>;
    return client.global({ query });
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

  type Preview = {
    summary: string;
    details: {
      customer: { name: string; email: string } | null;
      messages: Array<{ message: string; channel: string }>;
      reducesAvailability: boolean;
      money: {
        rentalPaid: string;
        depositCollected: string;
        refundedAutomatically: boolean;
      } | null;
      reservation: { number: string; from: string; to: string };
    };
  };
  const tokenOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
    (refusal.data.details as { confirmationToken: string }).confirmationToken;
  const previewOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
    (refusal.data.details as { preview: Preview }).preview;

  // --- Fixtures -------------------------------------------------------------

  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(12, "0")}`;

  async function product(quantity = 1, stockKind: "returnable" | "consumable" = "returnable") {
    const id = nextId("rs_prd");
    await louezDb.db.insert(louezDb.products).values({
      id,
      storeId: STORE,
      name: `Kayak ${id}`,
      price: "10.00",
      pricingMode: "day",
      stockKind,
      quantity,
    });
    return id;
  }

  async function reservation(
    status: "pending" | "confirmed" | "ongoing" | "completed" | "cancelled" | "quote" | "rejected",
    options: {
      productId?: string;
      store?: string;
      start?: Date;
      end?: Date;
      tulipContractId?: string | null;
      number?: string;
      createdAt?: Date;
    } = {},
  ) {
    const id = nextId("rs_res");
    const store = options.store ?? STORE;
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: store,
      customerId: store === STORE ? CUSTOMER : OTHER_CUSTOMER,
      number: options.number ?? id,
      status,
      startDate: options.start ?? START,
      endDate: options.end ?? END,
      subtotalAmount: "20.00",
      depositAmount: "50.00",
      totalAmount: "70.00",
      source: "online",
      deliveryAddress: "2 River Road",
      customerNotes: "Ring twice",
      tulipContractId: options.tulipContractId ?? null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    });
    if (options.productId) {
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("rs_itm"),
        reservationId: id,
        productId: options.productId,
        quantity: 1,
        unitPrice: "10.00",
        depositPerUnit: "50.00",
        totalPrice: "20.00",
        productSnapshot: { name: "Kayak", description: null, images: [] },
      });
    }
    return id;
  }

  async function statusOf(id: string) {
    const [row] = await louezDb.db
      .select({ status: louezDb.reservations.status })
      .from(louezDb.reservations)
      .where(orm.eq(louezDb.reservations.id, id));
    return row?.status;
  }

  /** The outbox rows, oldest first. */
  async function outbox() {
    return louezDb.db
      .select({
        id: louezDb.apiEffects.id,
        type: louezDb.apiEffects.type,
        status: louezDb.apiEffects.status,
        payload: louezDb.apiEffects.payload,
      })
      .from(louezDb.apiEffects)
      .orderBy(louezDb.apiEffects.seq);
  }
  const analyticsOf = async () =>
    (await outbox())
      .filter((row) => row.type === "reservation.statusAnalytics")
      .map((row) => row.payload);

  // --- Reads ----------------------------------------------------------------

  test("the list filters, counts and pages as the dashboard does", async () => {
    const pending = await reservation("pending", { number: "2030-0001" });
    const confirmed = await reservation("confirmed", {
      number: "2030-0002",
      start: new Date("2030-06-05T09:00:00Z"),
      end: new Date("2030-06-06T09:00:00Z"),
    });
    const cancelled = await reservation("cancelled", { number: "2030-0003" });
    const rejected = await reservation("rejected", { number: "2030-0004" });
    await reservation("pending", { store: OTHER_STORE, number: "2030-0005" });

    const all = await run("list", {}, session());
    assert.deepEqual(
      all.items.map((item) => item.id),
      [confirmed, pending],
      "open ones only, newest start first; another store's never",
    );
    assert.deepEqual(all.counts, {
      all: 2,
      pending: 1,
      confirmed: 1,
      ongoing: 0,
      completed: 0,
      cancelled: 2,
      quote: 0,
    });
    assert.equal(all.totalCount, 2);
    assert.equal(all.currency, "EUR");
    assert.equal(all.items[0]?.customer?.firstName, "Ada");

    const closed = await run("list", { status: "cancelled" }, session());
    assert.deepEqual(new Set(closed.items.map((item) => item.id)), new Set([cancelled, rejected]));

    const byName = await run("list", { search: "lovelace" }, session());
    assert.equal(byName.totalCount, 4, "a search finds closed reservations too");
    const byNumber = await run("list", { search: "0002" }, session());
    assert.deepEqual(
      byNumber.items.map((item) => item.id),
      [confirmed],
    );

    // A cursor walks the same order, one row at a time, without a repeat.
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await run("list", { status: "all", search: "20", limit: 1, cursor }, session());
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && seen.length < 10);
    assert.equal(seen.length, 4);
    assert.equal(new Set(seen).size, 4);

    const second = await run("list", { search: "20", limit: 1, page: 2 }, session());
    assert.equal(second.items[0]?.id, seen[1], "a page number reads the same order");

    await rejects(run("list", { cursor: "not-a-cursor" }, session()), "INVALID_CURSOR");
    const byAmount = await run("list", { sort: "amount", limit: 1 }, session());
    await rejects(run("list", { cursor: byAmount.nextCursor ?? "" }, session()), "INVALID_CURSOR");
  });

  test("without customers read, reservations come without their customer", async () => {
    const id = await reservation("pending", { number: "2030-0100" });
    await louezDb.db.insert(louezDb.reservationActivity).values({
      id: nextId("rs_act"),
      reservationId: id,
      activityType: "created",
      metadata: { email: "ada@rs.test" },
    });
    const key = await apiKey({ ...everything, customers: "none" });

    const page = await run("list", {}, key());
    assert.equal(page.items[0]?.customer, null);
    const byName = await run("list", { search: "lovelace" }, key());
    assert.equal(byName.items.length, 0, "a customer's name finds nothing");

    const detail = await run("get", { id }, key());
    assert.equal(detail.customer, null);
    assert.equal(detail.customerId, null);
    assert.equal(detail.deliveryAddress, null);
    assert.equal(detail.customerNotes, null);
    assert.equal(detail.activity[0]?.metadata, null);
    assert.equal(detail.totalAmount, "70.00", "the reservation itself stays");

    const poll = await run("poll", {}, key());
    assert.equal(poll.pendingReservations[0]?.customerName, null);

    const calendar = await run("listCalendarPeriod", { from: START, to: END }, key());
    assert.equal(calendar.items[0]?.customer, null);
    assert.equal(calendar.items[0]?.deliveryAddress, null);

    const found = await search("Ada", key());
    assert.deepEqual(found.customers, []);

    const full = await run("get", { id }, session());
    assert.equal(full.customer?.email, "ada@rs.test");
    assert.equal(full.deliveryAddress, "2 River Road");
  });

  test("reads need reservations read, and stay in the caller's store", async () => {
    const foreign = await reservation("pending", { store: OTHER_STORE });
    await rejects(run("get", { id: foreign }, session()), "RESERVATION_NOT_FOUND");
    const key = await apiKey({ ...everything, reservations: "none" });
    await rejects(run("list", {}, key()), "PERMISSION_DENIED");
    await rejects(search("Ada", key()), "PERMISSION_DENIED");
  });

  test("the detail shows lines, payments and history", async () => {
    const productId = await product();
    const id = await reservation("confirmed", { productId });
    await louezDb.db.insert(louezDb.payments).values({
      reservationId: id,
      amount: "20.00",
      type: "rental",
      method: "cash",
      status: "completed",
    });
    const detail = await run("get", { id }, session());
    assert.equal(detail.items[0]?.product?.id, productId);
    assert.equal(detail.items[0]?.productSnapshot.name, "Kayak");
    // Nested rows come through MySQL JSON, which drops trailing zeros, as the page always got them.
    assert.equal(Number(detail.payments[0]?.amount), 20);
    assert.deepEqual(detail.insuredProductIds, []);
    assert.equal(detail.currency, "EUR");
  });

  test("without payments read, no payment rows nor Stripe ids, only what was paid", async () => {
    const id = await reservation("confirmed", { number: "2030-0300" });
    await louezDb.db
      .update(louezDb.reservations)
      .set({ stripePaymentMethodId: "pm_secret" })
      .where(orm.eq(louezDb.reservations.id, id));
    await louezDb.db.insert(louezDb.payments).values({
      reservationId: id,
      amount: "20.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: "pi_secret",
      notes: "Paid by phone",
    });
    await louezDb.db.insert(louezDb.reservationActivity).values({
      id: nextId("rs_act"),
      reservationId: id,
      activityType: "payment_received",
      description: "Stripe payment",
      metadata: { paymentIntentId: "pi_secret" },
    });
    const key = await apiKey({ ...everything, payments: "none" });

    const detail = await run("get", { id }, key());
    assert.deepEqual(detail.payments, []);
    assert.equal(detail.stripePaymentMethodId, null);
    assert.equal(detail.rentalPaid, "20.00", "what was paid stays");
    assert.equal(detail.activity[0]?.metadata, null);
    assert.equal(detail.activity[0]?.description, null);
    assert.equal(detail.customer?.firstName, "Ada", "customers are another right");

    const page = await run("list", { search: "0300" }, key());
    assert.deepEqual(page.items[0]?.payments, []);
    assert.equal(page.items[0]?.rentalPaid, "20.00");
    const poll = await run("poll", {}, key());
    assert.ok(!JSON.stringify(poll).includes("pi_secret"));
    const found = await search("0300", key());
    assert.ok(!JSON.stringify(found).includes("pi_secret"));

    const full = await run("get", { id }, (await apiKey())());
    assert.equal(full.payments[0]?.stripePaymentIntentId, "pi_secret");
    assert.equal(full.payments[0]?.notes, "Paid by phone");
    assert.equal(full.stripePaymentMethodId, "pm_secret");
  });

  test("without customers read, no free text that may name the customer", async () => {
    const id = await reservation("confirmed");
    await louezDb.db
      .update(louezDb.reservations)
      .set({ internalNotes: "Call Ada on 06 12 34 56 78" })
      .where(orm.eq(louezDb.reservations.id, id));
    await louezDb.db.insert(louezDb.payments).values({
      reservationId: id,
      amount: "50.00",
      type: "deposit_capture",
      method: "stripe",
      status: "completed",
      notes: "Ada broke the paddle, 06 12 34 56 78",
    });
    await louezDb.db.insert(louezDb.reservationActivity).values({
      id: nextId("rs_act"),
      reservationId: id,
      activityType: "deposit_captured",
      description: "Damage reported by phone 06 12 34 56 78",
    });
    const key = await apiKey({ ...everything, customers: "none" });

    const detail = await run("get", { id }, key());
    assert.equal(detail.internalNotes, null);
    assert.equal(detail.payments[0]?.notes, null);
    assert.equal(detail.activity[0]?.description, null);
    assert.ok(!JSON.stringify(detail).includes("06 12 34 56 78"));
    for (const answer of [
      await run("list", {}, key()),
      await run("poll", {}, key()),
      await run("listCalendarPeriod", { from: START, to: END }, key()),
      await run("getPlanningTimeline", { from: START, to: END }, key()),
      await run("listUpcoming", { days: 90 }, key()),
      await run("listOverdue", {}, key()),
      await search(detail.number, key()),
    ]) {
      assert.ok(!JSON.stringify(answer).includes("Ada"), JSON.stringify(answer));
      assert.ok(!JSON.stringify(answer).includes("06 12 34 56 78"));
    }
  });

  test("without payments read, the payment filter is refused and history keeps only listed details", async () => {
    const id = await reservation("confirmed", { number: "2030-0400" });
    // A rental extension writes its Stripe session on a `modified` entry.
    await louezDb.db.insert(louezDb.reservationActivity).values({
      id: nextId("rs_act"),
      reservationId: id,
      activityType: "modified",
      metadata: {
        kind: "rental_extension",
        sessionId: "cs_secret",
        paymentId: "pay_secret",
        status: "paid",
      },
    });
    await louezDb.db.insert(louezDb.reservationActivity).values({
      id: nextId("rs_act"),
      reservationId: id,
      activityType: "confirmed",
      metadata: { previousStatus: "pending", newStatus: "confirmed", paymentIntentId: "pi_secret" },
    });
    const key = await apiKey({ ...everything, payments: "none" });

    const refusal = await rejects(
      run("list", { paymentMethod: "cash" }, key()),
      "PERMISSION_DENIED",
    );
    assert.deepEqual(refusal.data.details, { required: "payments:read" });

    const detail = await run("get", { id }, key());
    const byType = Object.fromEntries(
      detail.activity.map((entry) => [entry.activityType, entry.metadata]),
    );
    assert.deepEqual(byType.modified, { kind: "rental_extension" });
    assert.deepEqual(byType.confirmed, { previousStatus: "pending", newStatus: "confirmed" });
    assert.ok(!JSON.stringify(detail).includes("_secret"));

    const full = await run("get", { id }, (await apiKey())());
    assert.ok(JSON.stringify(full).includes("cs_secret"), "with payments read, all of it");
    assert.equal((await run("list", { paymentMethod: "cash" }, session())).totalCount, 0);
  });

  test("an agent's numbered pages stop at 10,000 rows; the dashboard's do not", async () => {
    const key = await apiKey();
    const refusal = await rejects(run("list", { page: 401, limit: 25 }, key()), "PAGE_TOO_DEEP");
    assert.equal(refusal.data.details?.maxOffset, 10_000);
    await run("list", { page: 400, limit: 25 }, key());
    await run("list", { page: 401, limit: 25 }, session());
  });

  test("numbered pages go as deep as the list", async () => {
    await louezDb.db.insert(louezDb.reservations).values(
      Array.from({ length: 402 }, (_, index) => ({
        id: `rs_deep_${String(index).padStart(13, "0")}`,
        storeId: STORE,
        customerId: CUSTOMER,
        number: `2031-${String(index).padStart(4, "0")}`,
        status: "pending" as const,
        startDate: new Date(START.getTime() + index * 60_000),
        endDate: END,
        subtotalAmount: "1.00",
        depositAmount: "0.00",
        totalAmount: "1.00",
      })),
    );
    const page = await run(
      "list",
      { page: 401, limit: 1, sort: "number", sortDirection: "asc" },
      session(),
    );
    assert.equal(page.items[0]?.number, "2031-0400");
    assert.equal(page.totalCount, 402);
  });

  test("the counters, the calendar, the planning and the agenda", async () => {
    const productId = await product(3);
    const now = Date.now();
    const pending = await reservation("pending", { productId });
    const pickup = await reservation("confirmed", {
      productId,
      start: new Date(now + 2 * 86_400_000),
      end: new Date(now + 4 * 86_400_000),
    });
    const late = await reservation("ongoing", {
      productId,
      start: new Date(now - 5 * 86_400_000),
      end: new Date(now - 2 * 86_400_000 - 3_600_000),
    });

    const poll = await run("poll", {}, session());
    assert.equal(poll.pendingCount, 1);
    assert.equal(poll.pendingReservations[0]?.id, pending);
    assert.equal(poll.pendingReservations[0]?.customerName, "Ada Lovelace");
    assert.equal(poll.latestReservation?.id, pending);
    assert.equal(poll.counts.ongoing, 1);

    const planning = await run("getPlanningTimeline", { from: START, to: END }, session());
    assert.deepEqual(
      planning.items.map((entry) => [entry.id, entry.productId, entry.quantity]),
      [[pending, productId, 1]],
    );

    const upcoming = await run("listUpcoming", { days: 7 }, session());
    assert.deepEqual(
      upcoming.pickups.map((entry) => entry.id),
      [pickup],
    );
    const overdue = await run("listOverdue", {}, session());
    assert.deepEqual(
      overdue.items.map((entry) => [entry.id, entry.daysLate]),
      [[late, 3]],
    );

    await rejects(
      run("listCalendarPeriod", { from: END, to: START }, session()),
      "RESERVATION_WINDOW_INVALID",
    );
  });

  test("the global search answers only what the connection may read", async () => {
    const productId = await product();
    await reservation("pending", { productId, number: "2030-0777" });
    const found = await search("Kayak", session());
    assert.equal(found.products[0]?.id, productId);

    const key = await apiKey({ ...everything, products: "none" });
    const limited = await search("0777", key());
    assert.deepEqual(limited.products, []);
    assert.equal(limited.reservations[0]?.number, "2030-0777");
    assert.equal(limited.reservations[0]?.customerName, "Ada Lovelace");
  });

  test("the global search matches a sensitive custom field for the dashboard only", async () => {
    // A connection could otherwise learn whose identity number it typed.
    const definitionId = nextId("rs_fld");
    await louezDb.db.insert(louezDb.customerFieldDefinitions).values({
      id: definitionId,
      storeId: STORE,
      key: `passport_${definitionId}`,
      label: "Passport number",
      type: "text",
      section: "Identity",
      isSensitive: true,
      isSearchable: true,
    });
    await louezDb.db.insert(louezDb.customerFieldValues).values({
      storeId: STORE,
      customerId: CUSTOMER,
      definitionId,
      value: "P9876543",
      searchValue: "p9876543",
    });
    try {
      const dashboard = await search("P98765", session());
      assert.deepEqual(
        dashboard.customers.map((customer) => customer.id),
        [CUSTOMER],
      );
      const key = await apiKey();
      const connection = await search("P98765", key());
      assert.deepEqual(connection.customers, []);
    } finally {
      await louezDb.db
        .delete(louezDb.customerFieldValues)
        .where(orm.eq(louezDb.customerFieldValues.definitionId, definitionId));
      await louezDb.db
        .delete(louezDb.customerFieldDefinitions)
        .where(orm.eq(louezDb.customerFieldDefinitions.id, definitionId));
    }
  });

  // --- Links ----------------------------------------------------------------

  test("every reservation an answer holds links its dashboard page, and its customer's when shown", async () => {
    const link = (id: string) => `${TEST_APP_URL}/dashboard/reservations/${id}?store=${STORE}`;
    const customerLink = `${TEST_APP_URL}/dashboard/customers/${CUSTOMER}?store=${STORE}`;
    const productId = await product(3);
    const now = Date.now();
    const pending = await reservation("pending", { productId, number: "2030-0888" });
    const pickup = await reservation("confirmed", {
      productId,
      start: new Date(now + 2 * 86_400_000),
      end: new Date(now + 4 * 86_400_000),
    });
    const late = await reservation("ongoing", {
      productId,
      start: new Date(now - 5 * 86_400_000),
      end: new Date(now - 2 * 86_400_000),
    });

    const page = await run("list", { status: "pending" }, session());
    const listed = page.items.find((item) => item.id === pending);
    assert.equal(listed?.links.dashboard, link(pending));
    assert.equal(listed?.customer?.links.dashboard, customerLink);

    const detail = await run("get", { id: pending }, session());
    assert.deepEqual(detail.links, { dashboard: link(pending) });
    assert.equal(detail.customer?.links.dashboard, customerLink);

    const poll = await run("poll", {}, session());
    assert.equal(poll.pendingReservations[0]?.links.dashboard, link(pending));
    assert.equal(poll.latestReservation?.links.dashboard, link(pending));

    const calendar = await run("listCalendarPeriod", { from: START, to: END }, session());
    const entry = calendar.items.find((item) => item.id === pending);
    assert.equal(entry?.links.dashboard, link(pending));
    assert.equal(entry?.customer?.links.dashboard, customerLink);
    const planning = await run("getPlanningTimeline", { from: START, to: END }, session());
    assert.equal(planning.items[0]?.links.dashboard, link(pending));

    const upcoming = await run("listUpcoming", { days: 7 }, session());
    assert.equal(upcoming.pickups[0]?.links.dashboard, link(pickup));
    assert.equal(upcoming.pickups[0]?.customer?.links.dashboard, customerLink);
    const overdue = await run("listOverdue", {}, session());
    assert.equal(overdue.items[0]?.links.dashboard, link(late));

    const found = await search("0888", session());
    assert.equal(found.reservations[0]?.links.dashboard, link(pending));
    const byName = await search("Lovelace", session());
    assert.equal(byName.customers[0]?.links.dashboard, customerLink);
    const byProduct = await search("Kayak", session());
    assert.equal(
      byProduct.products[0]?.links.dashboard,
      `${TEST_APP_URL}/dashboard/products/${productId}?store=${STORE}`,
    );

    // Writes answer with the reservation's link too.
    const notes = await run("updateNotes", { id: pickup, notes: "Paddles" }, session());
    assert.equal(notes.links.dashboard, link(pickup));
    const picked = await run("updateStatus", { id: pickup, status: "ongoing" }, session());
    assert.equal(picked.links.dashboard, link(pickup));
    const cancelled = await run("cancel", { id: pending }, session());
    assert.equal(cancelled.links.dashboard, link(pending));
  });

  test("without customers read, no answer names the customer, links included", async () => {
    const productId = await product(1);
    const id = await reservation("confirmed", { productId });
    const key = await apiKey({ ...everything, customers: "none" });

    const detail = await run("get", { id }, key());
    assert.equal(detail.customer, null);
    assert.equal(
      detail.links.dashboard,
      `${TEST_APP_URL}/dashboard/reservations/${id}?store=${STORE}`,
    );
    const answers = [
      detail,
      await run("list", {}, key()),
      await run("listCalendarPeriod", { from: START, to: END }, key()),
      await run("getPlanningTimeline", { from: START, to: END }, key()),
      await search(id, key()),
    ];
    for (const answer of answers) {
      const serialized = JSON.stringify(answer);
      assert.ok(!serialized.includes(CUSTOMER), serialized.slice(0, 300));
      assert.ok(!serialized.includes("/dashboard/customers/"), serialized.slice(0, 300));
    }
  });

  // --- Status changes ---------------------------------------------------------

  test("a confirmation from the dashboard takes the stock, records the fee and creates the contract", async () => {
    const productId = await product(1, "consumable");
    const id = await reservation("pending", { productId });

    const change = await run("updateStatus", { id, status: "confirmed" }, session());
    assert.deepEqual(
      { from: change.from, to: change.to, warnings: change.warnings },
      { from: "pending", to: "confirmed", warnings: [] },
    );
    assert.equal(await statusOf(id), "confirmed");
    const [stock] = await louezDb.db
      .select({ quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(orm.eq(louezDb.products.id, productId));
    assert.equal(stock?.quantity, 0, "the consumable left the stock");
    assert.equal(feeEffects.length, 1);
    assert.deepEqual(contracts, [`create:${id}`]);
    // The messages and notifications are in the outbox, handed to the app once committed.
    const rows = await outbox();
    // One row per channel: a failed SMS is retried without sending the email again.
    assert.deepEqual(rows.map((row) => `${row.type}:${String(row.payload.channel ?? "")}`).sort(), [
      "reservation.customerMessage:email",
      "reservation.platformNotification:discord",
      "reservation.platformNotification:fromhello",
      "reservation.statusAnalytics:",
      "reservation.storeNotification:discord",
      "reservation.storeNotification:push",
      "reservation.storeNotification:sms",
    ]);
    assert.deepEqual([...dispatched].sort(), rows.map((row) => row.id).sort());
    const message = rows.find((row) => row.type === "reservation.customerMessage")?.payload as {
      notification: string;
      customer: { email: string };
      reservation: { startDate: string };
    };
    assert.equal(message.notification, "customer_request_accepted");
    assert.equal(message.customer.email, "ada@rs.test");
    assert.equal(message.reservation.startDate, START.toISOString());
    assert.deepEqual(
      (await analyticsOf()).map((payload) => [payload.from, payload.to, payload.transport]),
      [["pending", "confirmed", "rpc"]],
    );
    const activity = await louezDb.db
      .select({
        type: louezDb.reservationActivity.activityType,
        userId: louezDb.reservationActivity.userId,
      })
      .from(louezDb.reservationActivity)
      .where(orm.eq(louezDb.reservationActivity.reservationId, id))
      .orderBy(louezDb.reservationActivity.activityType);
    // The change, by its user, then the contract it validated (no user).
    assert.deepEqual(activity, [
      { type: "confirmed", userId: OWNER },
      { type: "modified", userId: null },
    ]);
    const [contract] = await louezDb.db
      .select({
        validatedAt: louezDb.reservations.contractValidatedAt,
        signedAt: louezDb.reservations.signedAt,
      })
      .from(louezDb.reservations)
      .where(orm.eq(louezDb.reservations.id, id));
    assert.ok(contract?.validatedAt, "the contract is validated");
    assert.equal(contract?.signedAt, null, "validation is not the customer's signature");

    await rejects(
      run("updateStatus", { id, status: "confirmed" }, session()),
      "RESERVATION_TRANSITION_NOT_ALLOWED",
    );
  });

  test("a confirmation warns about the store's booking rules", async () => {
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: { ...settings, advanceNoticeMinutes: 60 * 24 * 365 * 20 } })
      .where(orm.eq(louezDb.stores.id, STORE));
    const id = await reservation("pending", { productId: await product() });
    const change = await run("updateStatus", { id, status: "confirmed" }, session());
    assert.deepEqual(
      change.warnings.map((warning) => warning.key),
      ["errors.advanceNoticeViolation"],
    );
  });

  test("an agent confirms only with the preview's token, once", async () => {
    const id = await reservation("pending", { productId: await product() });
    const key = await apiKey();

    const refusal = await rejects(
      run("updateStatus", { id, status: "confirmed" }, key()),
      "CONFIRMATION_REQUIRED",
    );
    const preview = previewOf(refusal);
    assert.match(preview.summary, /Ada Lovelace/);
    assert.match(preview.summary, /request accepted/);
    assert.deepEqual(preview.details.messages, [{ message: "request_accepted", channel: "email" }]);
    assert.equal(preview.details.reducesAvailability, true);
    assert.equal(await statusOf(id), "pending", "nothing was done");
    assert.equal((await outbox()).length, 0, "no message is queued before the confirmation");

    await rejects(
      run("updateStatus", { id, status: "confirmed" }, key({ "louez-confirmation": "forged" })),
      "CONFIRMATION_INVALID",
    );
    const token = tokenOf(refusal);
    // The token is bound to the input: a rejection cannot use it.
    await rejects(
      run("updateStatus", { id, status: "rejected" }, key({ "louez-confirmation": token })),
      "CONFIRMATION_INVALID",
    );

    const fresh = tokenOf(
      await rejects(
        run("updateStatus", { id, status: "confirmed" }, key()),
        "CONFIRMATION_REQUIRED",
      ),
    );
    const change = await run(
      "updateStatus",
      { id, status: "confirmed" },
      key({ "louez-confirmation": fresh }),
    );
    assert.equal(change.to, "confirmed");
    assert.deepEqual(
      (await analyticsOf()).map((payload) => payload.transport),
      ["openapi"],
    );
    const [activity] = await louezDb.db
      .select({ metadata: louezDb.reservationActivity.metadata })
      .from(louezDb.reservationActivity)
      .where(
        orm.and(
          orm.eq(louezDb.reservationActivity.reservationId, id),
          orm.eq(louezDb.reservationActivity.activityType, "confirmed"),
        ),
      );
    assert.equal(activity?.metadata?.actor, "api");

    // Spent: the same token never works twice.
    await louezDb.db
      .update(louezDb.reservations)
      .set({ status: "pending" })
      .where(orm.eq(louezDb.reservations.id, id));
    await rejects(
      run("updateStatus", { id, status: "confirmed" }, key({ "louez-confirmation": fresh })),
      "CONFIRMATION_INVALID",
    );
  });

  test("a token stops working when what the preview showed changes", async () => {
    const id = await reservation("pending", { productId: await product() });
    const key = await apiKey();
    const token = tokenOf(
      await rejects(
        run("updateStatus", { id, status: "rejected" }, key()),
        "CONFIRMATION_REQUIRED",
      ),
    );
    // The store turns the rejection email off: the preview said one goes out.
    const { DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS } = await import("@louez/types");
    await louezDb.db
      .update(louezDb.stores)
      .set({
        customerNotificationSettings: {
          ...DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
          customer_request_rejected: { enabled: false, email: false, sms: false },
        },
      })
      .where(orm.eq(louezDb.stores.id, STORE));
    await rejects(
      run("updateStatus", { id, status: "rejected" }, key({ "louez-confirmation": token })),
      "CONFIRMATION_INVALID",
    );
    assert.equal(await statusOf(id), "pending");

    const again = await rejects(
      run("updateStatus", { id, status: "rejected" }, key()),
      "CONFIRMATION_REQUIRED",
    );
    assert.deepEqual(previewOf(again).details.messages, []);
    assert.match(previewOf(again).summary, /No message goes to the customer/);
  });

  test("a token is bound to where the messages go, even what the preview does not show", async () => {
    const { DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS } = await import("@louez/types");
    await louezDb.db
      .update(louezDb.stores)
      .set({
        customerNotificationSettings: {
          ...DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
          customer_request_accepted: { enabled: true, email: true, sms: true },
        },
      })
      .where(orm.eq(louezDb.stores.id, STORE));
    await louezDb.db
      .update(louezDb.customers)
      .set({ phone: "+33600000001" })
      .where(orm.eq(louezDb.customers.id, CUSTOMER));
    try {
      const id = await reservation("pending", { productId: await product() });
      const key = await apiKey();
      const token = tokenOf(
        await rejects(
          run("updateStatus", { id, status: "confirmed" }, key()),
          "CONFIRMATION_REQUIRED",
        ),
      );
      // The SMS would now go to another phone: the preview never showed it.
      await louezDb.db
        .update(louezDb.customers)
        .set({ phone: "+33600000002" })
        .where(orm.eq(louezDb.customers.id, CUSTOMER));
      await rejects(
        run("updateStatus", { id, status: "confirmed" }, key({ "louez-confirmation": token })),
        "CONFIRMATION_INVALID",
      );

      // Without customers read the preview shows no email; it is bound all the same.
      const blind = await apiKey({ ...everything, customers: "none" });
      const blindRefusal = await rejects(
        run("updateStatus", { id, status: "confirmed" }, blind()),
        "CONFIRMATION_REQUIRED",
      );
      assert.equal(previewOf(blindRefusal).details.customer, null);
      assert.ok(!JSON.stringify(previewOf(blindRefusal)).includes("ada@rs.test"));
      await louezDb.db
        .update(louezDb.customers)
        .set({ email: "ada.new@rs.test" })
        .where(orm.eq(louezDb.customers.id, CUSTOMER));
      await rejects(
        run(
          "updateStatus",
          { id, status: "confirmed" },
          blind({ "louez-confirmation": tokenOf(blindRefusal) }),
        ),
        "CONFIRMATION_INVALID",
      );
      assert.equal(await statusOf(id), "pending");
    } finally {
      await louezDb.db
        .update(louezDb.customers)
        .set({ phone: null, email: "ada@rs.test" })
        .where(orm.eq(louezDb.customers.id, CUSTOMER));
    }
  });

  test("the preview, its token and the queued messages come from one snapshot", async () => {
    const { DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS } = await import("@louez/types");
    await louezDb.db
      .update(louezDb.stores)
      .set({
        customerNotificationSettings: {
          ...DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
          customer_request_accepted: { enabled: true, email: true, sms: true },
        },
      })
      .where(orm.eq(louezDb.stores.id, STORE));
    await louezDb.db
      .update(louezDb.customers)
      .set({ phone: "+33600000003" })
      .where(orm.eq(louezDb.customers.id, CUSTOMER));
    try {
      const id = await reservation("pending", { productId: await product() });
      const key = await apiKey();
      const refusal = await rejects(
        run("updateStatus", { id, status: "confirmed" }, key()),
        "CONFIRMATION_REQUIRED",
      );
      const announced = previewOf(refusal).details.messages.map((message) => message.channel);
      assert.deepEqual(announced, ["email", "sms"]);

      // The reservation's language changes: the token, bound to it, no longer works.
      await louezDb.db
        .update(louezDb.reservations)
        .set({ locale: "de" })
        .where(orm.eq(louezDb.reservations.id, id));
      await rejects(
        run(
          "updateStatus",
          { id, status: "confirmed" },
          key({ "louez-confirmation": tokenOf(refusal) }),
        ),
        "CONFIRMATION_INVALID",
      );

      const token = tokenOf(
        await rejects(
          run("updateStatus", { id, status: "confirmed" }, key()),
          "CONFIRMATION_REQUIRED",
        ),
      );
      await run("updateStatus", { id, status: "confirmed" }, key({ "louez-confirmation": token }));
      const queued = (await outbox()).filter((row) => row.type === "reservation.customerMessage");
      assert.deepEqual(
        queued.map((row) => row.payload.channel),
        announced,
        "exactly the channels the preview announced",
      );
      const sms = queued.find((row) => row.payload.channel === "sms")?.payload as {
        customer: { phone: string };
        reservation: { locale: string };
      };
      assert.equal(sms.customer.phone, "+33600000003");
      assert.equal(sms.reservation.locale, "de");
    } finally {
      await louezDb.db
        .update(louezDb.customers)
        .set({ phone: null })
        .where(orm.eq(louezDb.customers.id, CUSTOMER));
    }
  });

  test("a pick-up leaves the unsent acceptance email to go out", async () => {
    const id = await reservation("pending", { productId: await product() });
    await run("updateStatus", { id, status: "confirmed" }, session());
    await run("updateStatus", { id, status: "ongoing" }, session());
    const messages = (await outbox()).filter((row) => row.type === "reservation.customerMessage");
    assert.deepEqual(
      messages.map((row) => [row.status, row.payload.notification]),
      [["pending", "customer_request_accepted"]],
      "the acceptance, with its contract link, is still true",
    );
  });

  test("the store hears of a change by its dashboard or an agent as the store's, in the reservation's currency", async () => {
    const id = await reservation("pending", { productId: await product() });
    await louezDb.db
      .update(louezDb.reservations)
      .set({ currency: "GBP" })
      .where(orm.eq(louezDb.reservations.id, id));
    await run("updateStatus", { id, status: "confirmed" }, session());
    // An agent's change, through an API key: still the store's own.
    const key = await apiKey();
    await run("updateStatus", { id, status: "ongoing" }, key());

    const rows = await outbox();
    const storeRows = rows.filter((row) => row.type === "reservation.storeNotification");
    assert.deepEqual(
      storeRows.map((row) => [row.payload.event, row.payload.actor]),
      [
        ["reservation_confirmed", "store"],
        ["reservation_confirmed", "store"],
        ["reservation_confirmed", "store"],
        ["reservation_picked_up", "store"],
        ["reservation_picked_up", "store"],
        ["reservation_picked_up", "store"],
      ],
    );
    assert.ok(
      storeRows.every(
        (row) => (row.payload.reservation as { currency?: string }).currency === "GBP",
      ),
    );
    const platform = rows.filter((row) => row.type === "reservation.platformNotification");
    assert.ok(platform.length > 0 && platform.every((row) => row.payload.currency === "GBP"));
    // The customer's acceptance states its amounts in that currency too.
    const customerRows = rows.filter((row) => row.type === "reservation.customerMessage");
    assert.ok(
      customerRows.length > 0 &&
        customerRows.every(
          (row) => (row.payload.reservation as { currency?: string }).currency === "GBP",
        ),
    );
  });

  test("a later status change supersedes the earlier customer message still unsent", async () => {
    const id = await reservation("pending", { productId: await product() });
    await run("updateStatus", { id, status: "confirmed" }, session());
    await run("cancel", { id }, session());
    const messages = (await outbox()).filter((row) => row.type === "reservation.customerMessage");
    assert.deepEqual(
      messages.map((row) => row.status),
      ["superseded", "pending"],
      "the acceptance email speaks of a status no longer true",
    );
    assert.equal(
      messages[1]?.payload.notification,
      "customer_reservation_cancelled",
      "the cancellation goes out after it",
    );
    const storeRows = (await outbox()).filter(
      (row) => row.type === "reservation.storeNotification",
    );
    assert.deepEqual(
      storeRows.map((row) => row.payload.event),
      [
        "reservation_confirmed",
        "reservation_confirmed",
        "reservation_confirmed",
        "reservation_cancelled",
        "reservation_cancelled",
        "reservation_cancelled",
      ],
      "the store hears of both changes, in order: the cancellation goes out",
    );
    assert.ok(storeRows.every((row) => row.status === "pending"));
  });

  test("a pick-up needs no confirmation, and its replay with the same key runs once", async () => {
    const id = await reservation("confirmed", { productId: await product() });
    const key = await apiKey();

    const first = key({ "idempotency-key": "pickup-1" });
    const change = await run("updateStatus", { id, status: "ongoing" }, first);
    assert.equal(change.to, "ongoing");
    const replayContext = key({ "idempotency-key": "pickup-1" });
    const replay = await run("updateStatus", { id, status: "ongoing" }, replayContext);
    assert.deepEqual(replay, change);
    assert.equal(replayContext.receipt.replayed, true);
    assert.equal((await analyticsOf()).length, 1, "the change ran, and queued its effects, once");

    await rejects(
      run("updateStatus", { id, status: "completed" }, key({ "idempotency-key": "pickup-1" })),
      "IDEMPOTENCY_KEY_REUSED",
    );
  });

  test("a store that requires the signed contract refuses an unsigned pick-up until it is signed", async () => {
    const requiring = { ...settings, contractSignatureMode: "required" as const };
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: requiring })
      .where(orm.eq(louezDb.stores.id, STORE));
    try {
      const id = await reservation("confirmed", { productId: await product() });
      const key = await apiKey();
      const before = (await analyticsOf()).length;
      for (const context of [session(), key()]) {
        await rejects(run("updateStatus", { id, status: "ongoing" }, context), "CONTRACT_UNSIGNED");
      }
      assert.equal(await statusOf(id), "confirmed");
      assert.equal((await analyticsOf()).length, before, "nothing was queued");

      await louezDb.db
        .update(louezDb.reservations)
        .set({ signedAt: new Date(), signatureMethod: "in_store" })
        .where(orm.eq(louezDb.reservations.id, id));
      assert.equal((await run("updateStatus", { id, status: "ongoing" }, session())).to, "ongoing");
      const [pickup] = await louezDb.db
        .select({ metadata: louezDb.reservationActivity.metadata })
        .from(louezDb.reservationActivity)
        .where(
          orm.and(
            orm.eq(louezDb.reservationActivity.reservationId, id),
            orm.eq(louezDb.reservationActivity.activityType, "picked_up"),
          ),
        );
      assert.equal(pickup?.metadata?.contractUnsigned, undefined, "signed: nothing to record");
    } finally {
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings })
        .where(orm.eq(louezDb.stores.id, STORE));
    }

    // Recommended (the default): handed over anyway, and the history says so.
    const unsigned = await reservation("confirmed", { productId: await product() });
    await run("updateStatus", { id: unsigned, status: "ongoing" }, session());
    const [pickup] = await louezDb.db
      .select({ metadata: louezDb.reservationActivity.metadata })
      .from(louezDb.reservationActivity)
      .where(
        orm.and(
          orm.eq(louezDb.reservationActivity.reservationId, unsigned),
          orm.eq(louezDb.reservationActivity.activityType, "picked_up"),
        ),
      );
    assert.equal(pickup?.metadata?.contractUnsigned, true);
  });

  test("a read-only connection cannot change a status, and another store's id is not found", async () => {
    const id = await reservation("confirmed");
    const reader = await apiKey({ ...everything, reservations: "read" });
    await rejects(run("updateStatus", { id, status: "ongoing" }, reader()), "PERMISSION_DENIED");
    await rejects(run("cancel", { id }, reader()), "PERMISSION_DENIED");
    await rejects(run("updateNotes", { id, notes: "x" }, reader()), "PERMISSION_DENIED");

    const foreign = await reservation("confirmed", { store: OTHER_STORE });
    await rejects(
      run("updateStatus", { id: foreign, status: "ongoing" }, session()),
      "RESERVATION_NOT_FOUND",
    );
    await rejects(run("cancel", { id: foreign }, session()), "RESERVATION_NOT_FOUND");
    await rejects(
      run("updateNotes", { id: foreign, notes: "x" }, session()),
      "RESERVATION_NOT_FOUND",
    );
    assert.equal(await statusOf(foreign), "confirmed");
  });

  test("a rejection keeps its reason for the customer's email", async () => {
    const id = await reservation("pending");
    await run(
      "updateStatus",
      { id, status: "rejected", rejectionReason: "Fully booked" },
      session(),
    );
    const message = (await outbox()).find((row) => row.type === "reservation.customerMessage");
    assert.equal(message?.payload.notification, "customer_request_rejected");
    assert.equal(message?.payload.rejectionReason, "Fully booked");
  });

  // --- Cancellation -----------------------------------------------------------

  test("a cancellation previews what was paid, and restores the stock", async () => {
    const productId = await product(1, "consumable");
    const id = await reservation("pending", { productId, tulipContractId: "tulip_1" });
    await run("updateStatus", { id, status: "confirmed" }, session());
    await louezDb.db.insert(louezDb.payments).values({
      reservationId: id,
      amount: "20.00",
      type: "rental",
      method: "card",
      status: "completed",
    });
    contracts.length = 0;
    const key = await apiKey();

    const refusal = await rejects(run("cancel", { id }, key()), "CONFIRMATION_REQUIRED");
    const preview = previewOf(refusal);
    assert.equal(preview.details.money?.rentalPaid, "20.00");
    assert.equal(preview.details.money?.refundedAutomatically, false);
    assert.deepEqual(preview.details.messages, [
      { message: "reservation_cancelled", channel: "email" },
    ]);
    assert.match(
      preview.summary,
      /Ada Lovelace \(ada@rs\.test\) gets the "reservation cancelled" message by email\./,
    );
    assert.match(preview.summary, /Nothing is refunded/);
    assert.match(preview.summary, /The insurance contract is cancelled/);
    assert.equal(await statusOf(id), "confirmed");

    // A payment recorded since the preview voids its token.
    await louezDb.db.insert(louezDb.payments).values({
      reservationId: id,
      amount: "50.00",
      type: "deposit",
      method: "card",
      status: "completed",
    });
    await rejects(
      run("cancel", { id }, key({ "louez-confirmation": tokenOf(refusal) })),
      "CONFIRMATION_INVALID",
    );

    const token = tokenOf(await rejects(run("cancel", { id }, key()), "CONFIRMATION_REQUIRED"));
    const change = await run("cancel", { id }, key({ "louez-confirmation": token }));
    assert.deepEqual([change.from, change.to], ["confirmed", "cancelled"]);
    const [stock] = await louezDb.db
      .select({ quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(orm.eq(louezDb.products.id, productId));
    assert.equal(stock?.quantity, 1, "the consumable is back");
    assert.deepEqual(contracts, [`cancel:${id}`]);

    await rejects(run("cancel", { id }, session()), "RESERVATION_NOT_CANCELLABLE");
  });

  test("cancelled through the status menu works as the cancel button", async () => {
    const id = await reservation("confirmed", { tulipContractId: "tulip_2" });
    const change = await run("updateStatus", { id, status: "cancelled" }, session());
    assert.equal(change.to, "cancelled");
    assert.deepEqual(contracts, [`cancel:${id}`]);
  });

  /** The customer messages queued, as [notification, channel]. */
  const customerMessagesOf = async (reservationId: string) =>
    (await outbox())
      .filter(
        (row) =>
          row.type === "reservation.customerMessage" &&
          (row.payload.reservation as { id: string }).id === reservationId,
      )
      .map((row) => [row.payload.notification, row.payload.channel]);

  test("every cancellation the store makes tells the customer, through the outbox", async () => {
    const key = await apiKey();
    // The dashboard's cancel button and status menu.
    const byButton = await reservation("confirmed", { productId: await product() });
    await run("cancel", { id: byButton }, session());
    const byMenu = await reservation("pending");
    await run("updateStatus", { id: byMenu, status: "cancelled" }, session());
    // An agent's reservations_cancel and reservations_update_status, once confirmed.
    const byAgentCancel = await reservation("quote");
    await run(
      "cancel",
      { id: byAgentCancel },
      key({
        "louez-confirmation": tokenOf(
          await rejects(run("cancel", { id: byAgentCancel }, key()), "CONFIRMATION_REQUIRED"),
        ),
      }),
    );
    const byAgentStatus = await reservation("ongoing");
    await run(
      "updateStatus",
      { id: byAgentStatus, status: "cancelled" },
      key({
        "louez-confirmation": tokenOf(
          await rejects(
            run("updateStatus", { id: byAgentStatus, status: "cancelled" }, key()),
            "CONFIRMATION_REQUIRED",
          ),
        ),
      }),
    );

    for (const id of [byButton, byMenu, byAgentCancel, byAgentStatus]) {
      assert.deepEqual(await customerMessagesOf(id), [["customer_reservation_cancelled", "email"]]);
    }
    const message = (await outbox()).find(
      (row) =>
        row.type === "reservation.customerMessage" &&
        (row.payload.reservation as { id: string }).id === byButton,
    );
    const payload = message?.payload as {
      customer: { email: string };
      reservation: { number: string };
      items: Array<{ name: string; quantity: number }>;
      rejectionReason: string | null;
    };
    assert.equal(payload.customer.email, "ada@rs.test");
    assert.equal(payload.reservation.number, byButton);
    assert.deepEqual(
      payload.items.map((item) => [item.name, item.quantity]),
      [["Kayak", 1]],
    );
    assert.equal(payload.rejectionReason, null);
    assert.ok(dispatched.includes(message?.id ?? ""), "dispatched once committed, never inline");
  });

  test("a cancellation sends what the store's settings give its message, and nothing when off", async () => {
    const { DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS } = await import("@louez/types");
    const setCancellation = (prefs: { enabled: boolean; email: boolean; sms: boolean }) =>
      louezDb.db
        .update(louezDb.stores)
        .set({
          customerNotificationSettings: {
            ...DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
            customer_reservation_cancelled: prefs,
          },
        })
        .where(orm.eq(louezDb.stores.id, STORE));
    const key = await apiKey();
    const previewFor = async (id: string) =>
      previewOf(await rejects(run("cancel", { id }, key()), "CONFIRMATION_REQUIRED"));

    await louezDb.db
      .update(louezDb.customers)
      .set({ phone: "+33600000004" })
      .where(orm.eq(louezDb.customers.id, CUSTOMER));
    try {
      await setCancellation({ enabled: true, email: true, sms: true });
      const both = await reservation("confirmed");
      const preview = await previewFor(both);
      assert.deepEqual(
        preview.details.messages.map((entry) => entry.channel),
        ["email", "sms"],
      );
      assert.match(preview.summary, /gets the "reservation cancelled" message by email and sms\./);
      await run("cancel", { id: both }, session());
      assert.deepEqual(await customerMessagesOf(both), [
        ["customer_reservation_cancelled", "email"],
        ["customer_reservation_cancelled", "sms"],
      ]);

      // Turned off: the preview says so, and nothing is queued for the customer.
      await setCancellation({ enabled: false, email: true, sms: true });
      const off = await reservation("confirmed");
      const offPreview = await previewFor(off);
      assert.deepEqual(offPreview.details.messages, []);
      assert.match(offPreview.summary, /No message goes to the customer\./);
      await run("cancel", { id: off }, session());
      assert.deepEqual(await customerMessagesOf(off), []);
      const storeRows = (await outbox()).filter(
        (row) =>
          row.type === "reservation.storeNotification" &&
          (row.payload.reservation as { id: string }).id === off,
      );
      assert.equal(storeRows.length, 3, "the store's own notifications still go out");
    } finally {
      await louezDb.db
        .update(louezDb.customers)
        .set({ phone: null })
        .where(orm.eq(louezDb.customers.id, CUSTOMER));
    }
  });

  test("a cancellation sends nothing on a channel the customer has no address for", async () => {
    const { DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS } = await import("@louez/types");
    await louezDb.db
      .update(louezDb.stores)
      .set({
        customerNotificationSettings: {
          ...DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
          customer_reservation_cancelled: { enabled: true, email: false, sms: true },
        },
      })
      .where(orm.eq(louezDb.stores.id, STORE));
    const id = await reservation("confirmed");
    const key = await apiKey();
    // SMS only, and the customer has no phone.
    const preview = previewOf(await rejects(run("cancel", { id }, key()), "CONFIRMATION_REQUIRED"));
    assert.deepEqual(preview.details.messages, []);
    assert.match(preview.summary, /No message goes to the customer\./);
    await run("cancel", { id }, session());
    assert.deepEqual(await customerMessagesOf(id), []);
  });

  test("a store whose settings predate the cancellation message gets it by email", async () => {
    // Saved before the event existed: no customer_reservation_cancelled key.
    const { customer_reservation_cancelled: _missing, ...saved } = (await import("@louez/types"))
      .DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS;
    await louezDb.db
      .update(louezDb.stores)
      .set({ customerNotificationSettings: saved as never })
      .where(orm.eq(louezDb.stores.id, STORE));
    const id = await reservation("confirmed");
    await run("cancel", { id }, session());
    assert.deepEqual(await customerMessagesOf(id), [["customer_reservation_cancelled", "email"]]);
  });

  // --- Notes ----------------------------------------------------------------

  test("notes change without a confirmation", async () => {
    const id = await reservation("confirmed");
    const key = await apiKey();
    const updated = await run("updateNotes", { id, notes: "Bring the paddles" }, key());
    assert.equal(updated.internalNotes, "Bring the paddles");
    const detail = await run("get", { id }, session());
    assert.equal(detail.internalNotes, "Bring the paddles");
    assert.deepEqual(
      events.map((event) => event.type),
      ["reservation.notesUpdated"],
    );
    // An agent's change records its analytics event through the outbox.
    assert.deepEqual(
      (await outbox()).map((row) => [row.type, row.payload.transport, row.payload.hasNotes]),
      [["reservation.notesAnalytics", "openapi", true]],
    );
    // The dashboard records its own in the browser.
    await run("updateNotes", { id, notes: "" }, session());
    assert.equal((await outbox()).length, 1);
  });

  // --- Units a reservation holds, checked when it takes its stock (S4) ---------

  describe("confirming a quote that holds a unit", () => {
    /**
     * Two S and two L. A quote of three units of any size holds the first S;
     * a quote does not block, so that S may since have gone to another booking.
     */
    async function quoteHoldingUnit() {
      const productId = nextId("rs_prd");
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId: STORE,
        name: `Wetsuit ${productId}`,
        price: "10.00",
        pricingMode: "day",
        trackUnits: true,
        bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
        quantity: 4,
      });
      const unitIds: string[] = [];
      for (const [index, size] of ["S", "S", "L", "L"].entries()) {
        const unitId = nextId("rs_unt");
        unitIds.push(unitId);
        await louezDb.db.insert(louezDb.productUnits).values({
          id: unitId,
          productId,
          identifier: `${size}${index + 1}`,
          attributes: { size },
          combinationKey: `size:${size}`,
        });
      }
      const [unitId = ""] = unitIds;
      const quoteId = await reservation("quote");
      const itemId = await lineHolding(quoteId, productId, 3, unitId);
      return { productId, unitId, quoteId, itemId };
    }

    async function lineHolding(
      reservationId: string,
      productId: string,
      quantity: number,
      unitId: string,
    ) {
      const itemId = nextId("rs_itm");
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: itemId,
        reservationId,
        productId,
        quantity,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "20.00",
        productSnapshot: { name: "Wetsuit", description: null, images: [] },
      });
      await louezDb.db.insert(louezDb.reservationItemUnits).values({
        id: nextId("rs_asg"),
        reservationItemId: itemId,
        productUnitId: unitId,
        identifierSnapshot: "S1",
      });
      return itemId;
    }

    const confirm = (id: string) => run("updateStatus", { id, status: "confirmed" }, session());

    test("nobody else holds confirms it", async () => {
      const { quoteId } = await quoteHoldingUnit();

      assert.equal((await confirm(quoteId)).to, "confirmed");
    });

    test("since given to a confirmed booking is refused, and names the unit to the store", async () => {
      const { productId, unitId, quoteId, itemId } = await quoteHoldingUnit();
      await lineHolding(await reservation("confirmed"), productId, 1, unitId);

      const refusal = await rejects(confirm(quoteId), "RESERVATION_UNITS_UNAVAILABLE");

      assert.deepEqual(refusal.data, {
        code: "RESERVATION_UNITS_UNAVAILABLE",
        retryable: false,
        i18nKey: "errors.assignedUnitsConflict",
        details: { conflicts: [{ reservationItemId: itemId, unitId, identifier: "S1" }] },
      });
      assert.equal(await statusOf(quoteId), "quote", "nothing was written");
      assert.equal(feeEffects.length, 0);
      assert.equal((await outbox()).length, 0, "a refused change queues no message");
    });

    test("held by another booking is refused with allowOverbooking or overrideTurnoverBuffer too", async () => {
      const { productId, unitId, quoteId } = await quoteHoldingUnit();
      await lineHolding(await reservation("confirmed"), productId, 1, unitId);

      for (const flags of [
        { allowOverbooking: true },
        { overrideTurnoverBuffer: true },
        { allowOverbooking: true, overrideTurnoverBuffer: true },
      ]) {
        await rejects(
          run("updateStatus", { id: quoteId, status: "confirmed", ...flags }, session()),
          "RESERVATION_UNITS_UNAVAILABLE",
        );
      }
      assert.equal(await statusOf(quoteId), "quote", "nothing was written");
      assert.equal(feeEffects.length, 0);
      assert.equal((await outbox()).length, 0);
    });

    test("that is retired is refused", async () => {
      const { unitId, quoteId } = await quoteHoldingUnit();
      await louezDb.db
        .update(louezDb.productUnits)
        .set({ lifecycleStatus: "retired" })
        .where(orm.eq(louezDb.productUnits.id, unitId));

      await rejects(confirm(quoteId), "RESERVATION_UNITS_UNAVAILABLE");

      assert.equal(await statusOf(quoteId), "quote");
    });

    test("that another booking returns within the turnover buffer confirms it, and records the unit", async () => {
      const { productId, unitId, quoteId } = await quoteHoldingUnit();
      // Returned an hour before the start, with two hours asked between rentals.
      await lineHolding(
        await reservation("confirmed", {
          start: new Date(START.getTime() - 24 * 3_600_000),
          end: new Date(START.getTime() - 3_600_000),
        }),
        productId,
        1,
        unitId,
      );
      // Put back before each test.
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: { ...settings, turnoverBufferMinutes: 120 } })
        .where(orm.eq(louezDb.stores.id, STORE));

      assert.equal((await confirm(quoteId)).to, "confirmed");
      const [activity] = await louezDb.db
        .select({ metadata: louezDb.reservationActivity.metadata })
        .from(louezDb.reservationActivity)
        .where(
          orm.and(
            orm.eq(louezDb.reservationActivity.reservationId, quoteId),
            orm.eq(louezDb.reservationActivity.activityType, "confirmed"),
          ),
        );
      // The units the buffer alone reaches, next to the verdict of the check.
      assert.deepEqual(
        {
          turnoverBufferOnlyUnitIds: activity?.metadata?.turnoverBufferOnlyUnitIds,
          overbooked: activity?.metadata?.overbooked,
        },
        { turnoverBufferOnlyUnitIds: [unitId], overbooked: false },
      );
    });
  });

  // --- Confirming over the stock (S3; docs/domain/reservation-changes.md, slice 4) ---

  describe("confirming over the returnable stock", () => {
    /** A line of `quantity` on `reservationId`, created at `createdAt` (the lines' order). */
    async function lineOf(
      reservationId: string,
      productId: string,
      quantity: number,
      createdAt?: Date,
    ) {
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("rs_itm"),
        reservationId,
        productId,
        quantity,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "20.00",
        productSnapshot: { name: "Kayak", description: null, images: [] },
        ...(createdAt ? { createdAt } : {}),
      });
    }

    /** A kayak of `quantity`, of which a confirmed booking of the same dates holds `held`. */
    async function kayakHeld(quantity: number, held: number) {
      const productId = await product(quantity);
      if (held > 0) await lineOf(await reservation("confirmed"), productId, held);
      return productId;
    }

    /** A reservation of `status` asking `quantity` of the product, over the stock. */
    async function asking(status: "pending" | "quote", productId: string, quantity = 1) {
      const id = await reservation(status);
      await lineOf(id, productId, quantity);
      return id;
    }

    const confirmation = (id: string, allowOverbooking?: boolean) => ({
      id,
      status: "confirmed" as const,
      ...(allowOverbooking === undefined ? {} : { allowOverbooking }),
    });

    async function confirmedRow(id: string) {
      const [row] = await louezDb.db
        .select({ metadata: louezDb.reservationActivity.metadata })
        .from(louezDb.reservationActivity)
        .where(
          orm.and(
            orm.eq(louezDb.reservationActivity.reservationId, id),
            orm.eq(louezDb.reservationActivity.activityType, "confirmed"),
          ),
        );
      return row?.metadata ?? null;
    }

    /** Whether anything of a change was written: status, activity, messages, fees. */
    async function nothingWritten(id: string, status: "pending" | "quote") {
      assert.equal(await statusOf(id), status);
      const activity = await louezDb.db
        .select({ id: louezDb.reservationActivity.id })
        .from(louezDb.reservationActivity)
        .where(orm.eq(louezDb.reservationActivity.reservationId, id));
      assert.equal(activity.length, 0, "no activity row");
      assert.equal((await outbox()).length, 0, "no message queued");
      assert.equal(feeEffects.length, 0, "no fee");
      assert.deepEqual(contracts, [], "no insurance contract");
    }

    const shortfall = (productId: string, requested: number, available: number) => ({
      productId,
      productName: `Kayak ${productId}`,
      combinationKey: null,
      requested,
      available,
    });

    async function withBuffer(minutes: number) {
      // Put back before each test.
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: { ...settings, turnoverBufferMinutes: minutes } })
        .where(orm.eq(louezDb.stores.id, STORE));
    }

    /** An API key and its id, its confirmations on or off. */
    async function agentKey(options: { confirmSensitive?: boolean; permissions?: Permissions }) {
      const created = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId: STORE,
        userId: OWNER,
        name: "Overbooking agent",
        permissions: options.permissions ?? everything,
      });
      if (options.confirmSensitive === false) {
        await louezDb.db
          .update(louezDb.apiKeys)
          .set({ confirmSensitive: false })
          .where(orm.eq(louezDb.apiKeys.id, created.id));
      }
      return {
        id: created.id,
        call: (extra: Record<string, string> = {}) => ({
          headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
          transport: "openapi" as const,
          ports,
          receipt: {},
        }),
      };
    }

    type OverbookingPreview = { overbooking: { shortfalls: unknown[] } | null };
    const overbookingOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
      (previewOf(refusal).details as unknown as OverbookingPreview).overbooking;

    for (const status of ["quote", "pending"] as const) {
      test(`a ${status} over the stock is refused with its shortfalls, then confirmed over it on purpose`, async () => {
        const productId = await kayakHeld(1, 1);
        const id = await asking(status, productId);
        if (status === "pending") {
          // A paid request that lost its stock.
          await louezDb.db.insert(louezDb.payments).values({
            reservationId: id,
            amount: "20.00",
            type: "rental",
            method: "card",
            status: "completed",
          });
        }

        const refusal = await rejects(
          run("updateStatus", confirmation(id), session()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        assert.deepEqual(refusal.data, {
          code: "RESERVATION_INSUFFICIENT_CAPACITY",
          retryable: false,
          i18nKey: "errors.insufficientCapacity",
          details: { shortfalls: [shortfall(productId, 1, 0)] },
        });
        await nothingWritten(id, status);

        // `false` is no override either.
        await rejects(
          run("updateStatus", confirmation(id, false), session()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        await nothingWritten(id, status);

        const change = await run("updateStatus", confirmation(id, true), session());
        assert.equal(change.to, "confirmed");
        assert.equal(await statusOf(id), "confirmed");
        assert.deepEqual(await confirmedRow(id), {
          previousStatus: status,
          newStatus: "confirmed",
          actor: "store_user",
          overbooked: true,
          overbookingShortfalls: [shortfall(productId, 1, 0)],
          credential: { kind: "session", id: null },
        });
        assert.equal(feeEffects.length, 1, "the fee is recorded");
        assert.deepEqual(contracts, [`create:${id}`]);
        assert.ok((await outbox()).some((row) => row.type === "reservation.customerMessage"));
      });
    }

    test("consumable stock never goes below zero, whatever the flag", async () => {
      const productId = await product(0, "consumable");
      const id = await asking("pending", productId);

      const refusal = await rejects(
        run("updateStatus", confirmation(id, true), session()),
        "RESERVATION_ITEMS_UNAVAILABLE",
      );
      assert.equal(refusal.data.details, undefined);
      await nothingWritten(id, "pending");
    });

    test("a line short only with the turnover buffer is refused with allowOverbooking, and says it is the buffer", async () => {
      const productId = await product(1);
      // Returned an hour before the start, with two hours asked between rentals.
      await lineOf(
        await reservation("confirmed", {
          start: new Date(START.getTime() - 24 * 3_600_000),
          end: new Date(START.getTime() - 3_600_000),
        }),
        productId,
        1,
      );
      await withBuffer(120);
      const id = await asking("quote", productId);

      for (const allowOverbooking of [undefined, true]) {
        const refusal = await rejects(
          run("updateStatus", confirmation(id, allowOverbooking), session()),
          "RESERVATION_TURNOVER_BUFFER_CONFLICT",
        );
        assert.deepEqual(refusal.data, {
          code: "RESERVATION_TURNOVER_BUFFER_CONFLICT",
          retryable: false,
          i18nKey: "errors.turnoverBufferShortfall",
          details: { shortfalls: [shortfall(productId, 1, 0)] },
        });
        await nothingWritten(id, "quote");
      }
    });

    test("a buffer-only line next to a short one: the buffer refuses first, and allowOverbooking does not pass it", async () => {
      const short = await kayakHeld(1, 1);
      const buffered = await product(1);
      await lineOf(
        await reservation("confirmed", {
          start: new Date(START.getTime() - 24 * 3_600_000),
          end: new Date(START.getTime() - 3_600_000),
        }),
        buffered,
        1,
      );
      await withBuffer(120);
      const id = await reservation("quote");
      await lineOf(id, short, 1, new Date("2030-01-01T00:00:00Z"));
      await lineOf(id, buffered, 1, new Date("2030-01-01T00:00:01Z"));

      const refusal = await rejects(
        run("updateStatus", confirmation(id, true), session()),
        "RESERVATION_TURNOVER_BUFFER_CONFLICT",
      );
      // Only the buffer's line: the short one is the flag's.
      assert.deepEqual(refusal.data.details, { shortfalls: [shortfall(buffered, 1, 0)] });
      await nothingWritten(id, "quote");
    });

    test("several short lines are listed each, in the lines' fixed order", async () => {
      const kayak = await kayakHeld(2, 1);
      const paddle = await kayakHeld(1, 1);
      const id = await reservation("quote");
      // Written out of order: the check reads them by creation date, then id.
      await lineOf(id, kayak, 1, new Date("2030-01-01T00:00:02Z"));
      await lineOf(id, kayak, 2, new Date("2030-01-01T00:00:01Z"));
      await lineOf(id, paddle, 1, new Date("2030-01-01T00:00:00Z"));

      const shortfalls = [shortfall(paddle, 1, 0), shortfall(kayak, 2, 1), shortfall(kayak, 1, 0)];
      const refusal = await rejects(
        run("updateStatus", confirmation(id), session()),
        "RESERVATION_INSUFFICIENT_CAPACITY",
      );
      assert.deepEqual(refusal.data.details, { shortfalls });

      await run("updateStatus", confirmation(id, true), session());
      assert.deepEqual((await confirmedRow(id))?.overbookingShortfalls, shortfalls);
    });

    test("an agent books over the stock only after a preview that lists every shortfall, even with confirmations off", async () => {
      const productId = await kayakHeld(1, 1);
      const id = await asking("quote", productId);

      for (const confirmSensitive of [true, false]) {
        const agent = await agentKey({ confirmSensitive });
        // Without the flag, the stock refuses before any preview.
        await rejects(
          run("updateStatus", confirmation(id), agent.call()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        const refusal = await rejects(
          run("updateStatus", confirmation(id, true), agent.call()),
          "CONFIRMATION_REQUIRED",
        );
        assert.deepEqual(overbookingOf(refusal), { shortfalls: [shortfall(productId, 1, 0)] });
        assert.match(
          previewOf(refusal).summary,
          new RegExp(`booked over the stock all the same: Kayak ${productId}, 1 asked, 0 free`),
        );
        await nothingWritten(id, "quote");
      }

      const agent = await agentKey({ confirmSensitive: false });
      const token = tokenOf(
        await rejects(
          run("updateStatus", confirmation(id, true), agent.call()),
          "CONFIRMATION_REQUIRED",
        ),
      );
      // The token is bound to the input: no confirmation without the flag uses it.
      await rejects(
        run("updateStatus", confirmation(id), agent.call({ "louez-confirmation": token })),
        "RESERVATION_INSUFFICIENT_CAPACITY",
      );
      const change = await run(
        "updateStatus",
        confirmation(id, true),
        agent.call({ "louez-confirmation": token }),
      );
      assert.equal(change.to, "confirmed");
      const row = await confirmedRow(id);
      assert.deepEqual(
        {
          actor: row?.actor,
          overbooked: row?.overbooked,
          overbookingShortfalls: row?.overbookingShortfalls,
          credential: row?.credential,
        },
        {
          actor: "api",
          overbooked: true,
          overbookingShortfalls: [shortfall(productId, 1, 0)],
          credential: { kind: "api_key", id: agent.id },
        },
      );
    });

    test("an agent's flag on a confirmation the stock covers still asks, and books nothing over", async () => {
      const productId = await kayakHeld(1, 0);
      const id = await asking("quote", productId);
      const agent = await agentKey({ confirmSensitive: false });

      const refusal = await rejects(
        run("updateStatus", confirmation(id, true), agent.call()),
        "CONFIRMATION_REQUIRED",
      );
      assert.deepEqual(overbookingOf(refusal), { shortfalls: [] });
      assert.match(previewOf(refusal).summary, /The stock covers it/);
      await run(
        "updateStatus",
        confirmation(id, true),
        agent.call({ "louez-confirmation": tokenOf(refusal) }),
      );
      assert.deepEqual(
        {
          overbooked: (await confirmedRow(id))?.overbooked,
          credential: (await confirmedRow(id))?.credential,
        },
        { overbooked: false, credential: undefined },
      );
    });

    test("a token approves the shortage it previewed, not one that grew since", async () => {
      // Three kayaks, one held: the quote of three is short by one.
      const productId = await kayakHeld(3, 1);
      const id = await asking("quote", productId, 3);
      const agent = await agentKey({});

      const first = await rejects(
        run("updateStatus", confirmation(id, true), agent.call()),
        "CONFIRMATION_REQUIRED",
      );
      assert.deepEqual(overbookingOf(first), { shortfalls: [shortfall(productId, 3, 2)] });

      // Another booking takes the two left, without touching this quote: short by three.
      await lineOf(await reservation("confirmed"), productId, 2);
      await rejects(
        run(
          "updateStatus",
          confirmation(id, true),
          agent.call({ "louez-confirmation": tokenOf(first) }),
        ),
        "CONFIRMATION_INVALID",
      );
      await nothingWritten(id, "quote");

      const second = await rejects(
        run("updateStatus", confirmation(id, true), agent.call()),
        "CONFIRMATION_REQUIRED",
      );
      assert.deepEqual(overbookingOf(second), { shortfalls: [shortfall(productId, 3, 0)] });
      await run(
        "updateStatus",
        confirmation(id, true),
        agent.call({ "louez-confirmation": tokenOf(second) }),
      );
      assert.deepEqual((await confirmedRow(id))?.overbookingShortfalls, [
        shortfall(productId, 3, 0),
      ]);
    });

    test("a read-only connection cannot confirm over the stock", async () => {
      const id = await asking("quote", await kayakHeld(1, 1));
      const reader = await agentKey({ permissions: { ...everything, reservations: "read" } });

      await rejects(
        run("updateStatus", confirmation(id, true), reader.call()),
        "PERMISSION_DENIED",
      );
      await nothingWritten(id, "quote");
    });

    test("two confirmations over the last kayak at once both go through, each with what it saw", async () => {
      const productId = await product(1);
      const first = await asking("pending", productId);
      const second = await asking("pending", productId);

      const outcomes = await raceOnLockedRow(database, { table: "products", id: productId }, [
        () => run("updateStatus", confirmation(first, true), session()).then((c) => c.to),
        () => run("updateStatus", confirmation(second, true), session()).then((c) => c.to),
      ]);
      assert.deepEqual(outcomes, ["confirmed", "confirmed"]);
      // Whichever took the lock first fit; the other booked over what the first took.
      const verdicts = [await confirmedRow(first), await confirmedRow(second)]
        .map((row) => ({
          overbooked: row?.overbooked,
          overbookingShortfalls: row?.overbookingShortfalls,
        }))
        .sort((a, b) => Number(a.overbooked) - Number(b.overbooked));
      assert.deepEqual(verdicts, [
        { overbooked: false, overbookingShortfalls: undefined },
        { overbooked: true, overbookingShortfalls: [shortfall(productId, 1, 0)] },
      ]);
    });

    describe("confirming past the turnover buffer", () => {
      const HOUR = 3_600_000;
      const BUFFER = 120;

      /** A kayak of one, returned by another booking an hour before START: short only with the buffer. */
      async function kayakInBuffer() {
        const productId = await product(1);
        await returnedBeforeStart(productId);
        return productId;
      }

      /** A confirmed booking of the product, back an hour before START, in a store that asks two hours. */
      async function returnedBeforeStart(productId: string) {
        await lineOf(
          await reservation("confirmed", {
            start: new Date(START.getTime() - 24 * HOUR),
            end: new Date(START.getTime() - HOUR),
          }),
          productId,
          1,
        );
        await withBuffer(BUFFER);
      }

      type Flags = { allowOverbooking?: boolean; overrideTurnoverBuffer?: boolean };
      const confirmWith = (id: string, flags: Flags) => ({ ...confirmation(id), ...flags });

      type BufferPreview = {
        overbooking: { shortfalls: unknown[] } | null;
        turnoverBuffer: { shortfalls: unknown[]; turnoverBufferMinutes: number } | null;
      };
      const overridesOf = (refusal: { data: { details?: Record<string, unknown> } }) => {
        const { overbooking, turnoverBuffer } = previewOf(refusal)
          .details as unknown as BufferPreview;
        return { overbooking, turnoverBuffer };
      };

      for (const status of ["quote", "pending"] as const) {
        test(`a ${status} short only with the buffer is refused with its lines, then confirmed past it on purpose`, async () => {
          const productId = await kayakInBuffer();
          const id = await asking(status, productId);
          if (status === "pending") {
            // A paid request.
            await louezDb.db.insert(louezDb.payments).values({
              reservationId: id,
              amount: "20.00",
              type: "rental",
              method: "card",
              status: "completed",
            });
          }

          for (const flags of [{}, { overrideTurnoverBuffer: false }, { allowOverbooking: true }]) {
            const refusal = await rejects(
              run("updateStatus", confirmWith(id, flags), session()),
              "RESERVATION_TURNOVER_BUFFER_CONFLICT",
            );
            assert.deepEqual(refusal.data.details, { shortfalls: [shortfall(productId, 1, 0)] });
            await nothingWritten(id, status);
          }

          const change = await run(
            "updateStatus",
            confirmWith(id, { overrideTurnoverBuffer: true }),
            session(),
          );
          assert.equal(change.to, "confirmed");
          assert.equal(await statusOf(id), "confirmed");
          assert.deepEqual(await confirmedRow(id), {
            previousStatus: status,
            newStatus: "confirmed",
            actor: "store_user",
            overbooked: false,
            turnoverBufferOverridden: true,
            turnoverBufferShortfalls: [shortfall(productId, 1, 0)],
            turnoverBufferMinutes: BUFFER,
            credential: { kind: "session", id: null },
          });
          assert.equal(feeEffects.length, 1, "the fee is recorded");
          assert.deepEqual(contracts, [`create:${id}`]);
          assert.ok((await outbox()).some((row) => row.type === "reservation.customerMessage"));
        });
      }

      test("overrideTurnoverBuffer never passes a line the stock itself cannot cover", async () => {
        const productId = await kayakHeld(1, 1);
        await withBuffer(BUFFER);
        const id = await asking("quote", productId);

        const refusal = await rejects(
          run("updateStatus", confirmWith(id, { overrideTurnoverBuffer: true }), session()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        assert.deepEqual(refusal.data.details, { shortfalls: [shortfall(productId, 1, 0)] });
        await nothingWritten(id, "quote");
      });

      test("short both ways: refused on the buffer first, then on the stock, and confirmed with both flags", async () => {
        const short = await kayakHeld(1, 1);
        const buffered = await kayakInBuffer();
        const id = await reservation("quote");
        await lineOf(id, short, 1, new Date("2030-01-01T00:00:00Z"));
        await lineOf(id, buffered, 1, new Date("2030-01-01T00:00:01Z"));

        for (const flags of [{}, { allowOverbooking: true }]) {
          const refusal = await rejects(
            run("updateStatus", confirmWith(id, flags), session()),
            "RESERVATION_TURNOVER_BUFFER_CONFLICT",
          );
          assert.deepEqual(refusal.data.details, { shortfalls: [shortfall(buffered, 1, 0)] });
        }
        const refusal = await rejects(
          run("updateStatus", confirmWith(id, { overrideTurnoverBuffer: true }), session()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        assert.deepEqual(refusal.data.details, { shortfalls: [shortfall(short, 1, 0)] });
        await nothingWritten(id, "quote");

        await run(
          "updateStatus",
          confirmWith(id, { allowOverbooking: true, overrideTurnoverBuffer: true }),
          session(),
        );
        assert.deepEqual(await confirmedRow(id), {
          previousStatus: "quote",
          newStatus: "confirmed",
          actor: "store_user",
          overbooked: true,
          overbookingShortfalls: [shortfall(short, 1, 0)],
          turnoverBufferOverridden: true,
          turnoverBufferShortfalls: [shortfall(buffered, 1, 0)],
          turnoverBufferMinutes: BUFFER,
          credential: { kind: "session", id: null },
        });
      });

      test("consumable stock at zero refuses whatever the flags", async () => {
        const productId = await product(0, "consumable");
        await withBuffer(BUFFER);
        const id = await asking("pending", productId);

        const refusal = await rejects(
          run(
            "updateStatus",
            confirmWith(id, { overrideTurnoverBuffer: true, allowOverbooking: true }),
            session(),
          ),
          "RESERVATION_ITEMS_UNAVAILABLE",
        );
        assert.equal(refusal.data.details, undefined);
        await nothingWritten(id, "pending");
      });

      test("the flag with nothing short only with the buffer records that, with no credential", async () => {
        const productId = await product(1);
        await withBuffer(BUFFER);
        const id = await asking("quote", productId);

        await run("updateStatus", confirmWith(id, { overrideTurnoverBuffer: true }), session());
        const row = await confirmedRow(id);
        assert.deepEqual(
          {
            overbooked: row?.overbooked,
            turnoverBufferOverridden: row?.turnoverBufferOverridden,
            turnoverBufferShortfalls: row?.turnoverBufferShortfalls,
            credential: row?.credential,
          },
          {
            overbooked: false,
            turnoverBufferOverridden: false,
            turnoverBufferShortfalls: undefined,
            credential: undefined,
          },
        );
      });

      test("without the flag the row says nothing of the buffer", async () => {
        const id = await asking("quote", await product(1));
        await withBuffer(BUFFER);

        await run("updateStatus", confirmation(id), session());
        assert.equal((await confirmedRow(id))?.turnoverBufferOverridden, undefined);
      });

      test("an agent confirms past the buffer only after a preview that lists its lines, even with confirmations off", async () => {
        const productId = await kayakInBuffer();
        const id = await asking("quote", productId);

        for (const confirmSensitive of [true, false]) {
          const agent = await agentKey({ confirmSensitive });
          // Without the flag, the buffer refuses before any preview.
          await rejects(
            run("updateStatus", confirmation(id), agent.call()),
            "RESERVATION_TURNOVER_BUFFER_CONFLICT",
          );
          const refusal = await rejects(
            run("updateStatus", confirmWith(id, { overrideTurnoverBuffer: true }), agent.call()),
            "CONFIRMATION_REQUIRED",
          );
          assert.deepEqual(overridesOf(refusal), {
            overbooking: null,
            turnoverBuffer: {
              shortfalls: [shortfall(productId, 1, 0)],
              turnoverBufferMinutes: BUFFER,
            },
          });
          assert.match(
            previewOf(refusal).summary,
            new RegExp(
              `not the ${BUFFER}-minute turnover buffer .* confirmed past it all the same: Kayak ${productId}, 1 asked, 0 free with the buffer`,
            ),
          );
          await nothingWritten(id, "quote");
        }

        const agent = await agentKey({ confirmSensitive: false });
        const token = tokenOf(
          await rejects(
            run("updateStatus", confirmWith(id, { overrideTurnoverBuffer: true }), agent.call()),
            "CONFIRMATION_REQUIRED",
          ),
        );
        // The token is bound to the input: no confirmation without the flag uses it.
        await rejects(
          run("updateStatus", confirmation(id), agent.call({ "louez-confirmation": token })),
          "RESERVATION_TURNOVER_BUFFER_CONFLICT",
        );
        await run(
          "updateStatus",
          confirmWith(id, { overrideTurnoverBuffer: true }),
          agent.call({ "louez-confirmation": token }),
        );
        const row = await confirmedRow(id);
        assert.deepEqual(
          {
            actor: row?.actor,
            turnoverBufferOverridden: row?.turnoverBufferOverridden,
            turnoverBufferShortfalls: row?.turnoverBufferShortfalls,
            credential: row?.credential,
          },
          {
            actor: "api",
            turnoverBufferOverridden: true,
            turnoverBufferShortfalls: [shortfall(productId, 1, 0)],
            credential: { kind: "api_key", id: agent.id },
          },
        );
      });

      test("an agent's two flags ask once, with both lists in one preview", async () => {
        const short = await kayakHeld(1, 1);
        const buffered = await kayakInBuffer();
        const id = await reservation("quote");
        await lineOf(id, short, 1, new Date("2030-01-01T00:00:00Z"));
        await lineOf(id, buffered, 1, new Date("2030-01-01T00:00:01Z"));
        const agent = await agentKey({ confirmSensitive: false });
        const both = { allowOverbooking: true, overrideTurnoverBuffer: true };

        const refusal = await rejects(
          run("updateStatus", confirmWith(id, both), agent.call()),
          "CONFIRMATION_REQUIRED",
        );
        assert.deepEqual(overridesOf(refusal), {
          overbooking: { shortfalls: [shortfall(short, 1, 0)] },
          turnoverBuffer: {
            shortfalls: [shortfall(buffered, 1, 0)],
            turnoverBufferMinutes: BUFFER,
          },
        });
        await run(
          "updateStatus",
          confirmWith(id, both),
          agent.call({ "louez-confirmation": tokenOf(refusal) }),
        );
        const row = await confirmedRow(id);
        assert.deepEqual(
          [row?.overbookingShortfalls, row?.turnoverBufferShortfalls],
          [[shortfall(short, 1, 0)], [shortfall(buffered, 1, 0)]],
        );
      });

      test("a token confirms past the buffer it previewed, not a buffer shortfall that appeared since", async () => {
        // Two kayaks of one each: only the first is short with the buffer.
        const first = await kayakInBuffer();
        const second = await product(1);
        const id = await reservation("quote");
        await lineOf(id, first, 1, new Date("2030-01-01T00:00:00Z"));
        await lineOf(id, second, 1, new Date("2030-01-01T00:00:01Z"));
        const agent = await agentKey({});
        const flag = { overrideTurnoverBuffer: true };

        const preview = await rejects(
          run("updateStatus", confirmWith(id, flag), agent.call()),
          "CONFIRMATION_REQUIRED",
        );
        assert.deepEqual(overridesOf(preview).turnoverBuffer?.shortfalls, [shortfall(first, 1, 0)]);

        // Another booking lands in the second kayak's buffer, without touching this quote.
        await returnedBeforeStart(second);
        await rejects(
          run(
            "updateStatus",
            confirmWith(id, flag),
            agent.call({ "louez-confirmation": tokenOf(preview) }),
          ),
          "CONFIRMATION_INVALID",
        );
        await nothingWritten(id, "quote");

        const again = await rejects(
          run("updateStatus", confirmWith(id, flag), agent.call()),
          "CONFIRMATION_REQUIRED",
        );
        const both = [shortfall(first, 1, 0), shortfall(second, 1, 0)];
        assert.deepEqual(overridesOf(again).turnoverBuffer?.shortfalls, both);
        await run(
          "updateStatus",
          confirmWith(id, flag),
          agent.call({ "louez-confirmation": tokenOf(again) }),
        );
        assert.deepEqual((await confirmedRow(id))?.turnoverBufferShortfalls, both);
      });

      test("a read-only connection cannot confirm past the buffer", async () => {
        const id = await asking("quote", await kayakInBuffer());
        const reader = await agentKey({ permissions: { ...everything, reservations: "read" } });

        await rejects(
          run("updateStatus", confirmWith(id, { overrideTurnoverBuffer: true }), reader.call()),
          "PERMISSION_DENIED",
        );
        await nothingWritten(id, "quote");
      });

      test("two confirmations past the buffer of the last kayak at once: the first passes the buffer, the second finds the stock gone", async () => {
        const productId = await kayakInBuffer();
        const first = await asking("pending", productId);
        const second = await asking("pending", productId);
        const flag = { overrideTurnoverBuffer: true };
        const answer = (id: string) =>
          run("updateStatus", confirmWith(id, flag), session()).then(
            (change) => change.to,
            (error: { data?: { code?: string } }) => error.data?.code,
          );

        const outcomes = await raceOnLockedRow(database, { table: "products", id: productId }, [
          () => answer(first),
          () => answer(second),
        ]);
        // Whichever took the lock first had only the buffer against it. The
        // other then finds the kayak held without the buffer too: a capacity
        // shortfall, which this flag never passes.
        assert.deepEqual([...outcomes].sort(), ["RESERVATION_INSUFFICIENT_CAPACITY", "confirmed"]);
        const winner = outcomes[0] === "confirmed" ? first : second;
        const row = await confirmedRow(winner);
        assert.deepEqual(
          [row?.turnoverBufferOverridden, row?.turnoverBufferShortfalls],
          [true, [shortfall(productId, 1, 0)]],
        );
        assert.equal(await statusOf(winner === first ? second : first), "pending");
      });
    });

    describe("a unit the quote holds that another booking's open choice needs", () => {
      /**
       * S/red, S/blue, L/red, L/blue. A confirmed booking asks two S, colour
       * open, and holds no unit: both S units are owed to it. A quote of
       * three, of any size and colour, holds `held`.
       */
      async function wetsuitQuote(held: "S/red" | "L/red") {
        const productId = nextId("rs_prd");
        await louezDb.db.insert(louezDb.products).values({
          id: productId,
          storeId: STORE,
          name: `Wetsuit ${productId}`,
          price: "10.00",
          pricingMode: "day",
          trackUnits: true,
          bookingAttributeAxes: [
            { key: "size", label: "Size", position: 0 },
            { key: "color", label: "Color", position: 1 },
          ],
          quantity: 4,
        });
        const unitIds = new Map<string, string>();
        for (const name of ["S/red", "S/blue", "L/red", "L/blue"]) {
          const [size = "", color = ""] = name.split("/");
          const unitId = nextId("rs_unt");
          unitIds.set(name, unitId);
          await louezDb.db.insert(louezDb.productUnits).values({
            id: unitId,
            productId,
            identifier: name,
            attributes: { size, color },
            combinationKey: `size:${size}|color:${color}`,
          });
        }
        const line = async (reservationId: string, quantity: number, size?: string) => {
          const itemId = nextId("rs_itm");
          await louezDb.db.insert(louezDb.reservationItems).values({
            id: itemId,
            reservationId,
            productId,
            quantity,
            selectedAttributes: size ? { size } : null,
            combinationKey: null,
            unitPrice: "10.00",
            depositPerUnit: "0.00",
            totalPrice: "30.00",
            productSnapshot: { name: "Wetsuit", description: null, images: [] },
          });
          return itemId;
        };
        await line(await reservation("confirmed"), 2, "S");
        const quoteId = await reservation("quote");
        const itemId = await line(quoteId, 3);
        const unitId = unitIds.get(held) ?? "";
        const assignmentId = nextId("rs_asg");
        await louezDb.db.insert(louezDb.reservationItemUnits).values({
          id: assignmentId,
          reservationItemId: itemId,
          productUnitId: unitId,
          identifierSnapshot: held,
        });
        // Three asked; the two L units are all the other booking leaves.
        const short = {
          productId,
          productName: `Wetsuit ${productId}`,
          combinationKey: null,
          requested: 3,
          available: 2,
        };
        return { quoteId, itemId, unitId, assignmentId, short };
      }

      async function heldUnitIds(itemId: string) {
        const rows = await louezDb.db
          .select({ unitId: louezDb.reservationItemUnits.productUnitId })
          .from(louezDb.reservationItemUnits)
          .where(orm.eq(louezDb.reservationItemUnits.reservationItemId, itemId));
        return rows.map((row) => row.unitId);
      }

      test("refuses the confirmation, flag or not, naming the unit; without it, the flag books the line over", async () => {
        const { quoteId, itemId, unitId, assignmentId, short } = await wetsuitQuote("S/red");

        for (const flags of [
          {},
          { allowOverbooking: true },
          { overrideTurnoverBuffer: true },
          { allowOverbooking: true, overrideTurnoverBuffer: true },
        ]) {
          const refusal = await rejects(
            run("updateStatus", { ...confirmation(quoteId), ...flags }, session()),
            "RESERVATION_UNITS_UNAVAILABLE",
          );
          assert.deepEqual(refusal.data.details, {
            conflicts: [
              {
                reservationItemId: itemId,
                unitId,
                identifier: "S/red",
                reason: "owed_to_other_bookings",
              },
            ],
          });
        }
        await nothingWritten(quoteId, "quote");

        // The store takes the unit off the line: only the stock is short now.
        await louezDb.db
          .delete(louezDb.reservationItemUnits)
          .where(orm.eq(louezDb.reservationItemUnits.id, assignmentId));
        const refusal = await rejects(
          run("updateStatus", confirmation(quoteId), session()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        assert.deepEqual(refusal.data.details, { shortfalls: [short] });
        const change = await run("updateStatus", confirmation(quoteId, true), session());
        assert.equal(change.to, "confirmed");
        const row = await confirmedRow(quoteId);
        assert.deepEqual(
          { overbooked: row?.overbooked, overbookingShortfalls: row?.overbookingShortfalls },
          { overbooked: true, overbookingShortfalls: [short] },
        );
      });

      test("a held unit that fits stays, and the flag books over the rest of the line", async () => {
        const { quoteId, itemId, unitId, short } = await wetsuitQuote("L/red");

        const refusal = await rejects(
          run("updateStatus", confirmation(quoteId), session()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        assert.deepEqual(refusal.data.details, { shortfalls: [short] });
        await nothingWritten(quoteId, "quote");

        const change = await run("updateStatus", confirmation(quoteId, true), session());
        assert.equal(change.to, "confirmed");
        const row = await confirmedRow(quoteId);
        assert.deepEqual(
          { overbooked: row?.overbooked, overbookingShortfalls: row?.overbookingShortfalls },
          { overbooked: true, overbookingShortfalls: [short] },
        );
        assert.deepEqual(await heldUnitIds(itemId), [unitId]);
      });

      test("an agent's flag is refused before any preview, its confirmations on or off", async () => {
        const { quoteId, itemId } = await wetsuitQuote("S/red");

        for (const confirmSensitive of [true, false]) {
          const agent = await agentKey({ confirmSensitive });
          await rejects(
            run("updateStatus", confirmation(quoteId, true), agent.call()),
            "RESERVATION_UNITS_UNAVAILABLE",
          );
        }
        await nothingWritten(quoteId, "quote");
        assert.equal((await heldUnitIds(itemId)).length, 1);
      });
    });

    describe("the units a quote holds, against the other bookings only", () => {
      /** A wetsuit with one size axis and a unit of each size listed, named by its size and rank. */
      async function wetsuit(sizes: string[]) {
        const productId = nextId("rs_prd");
        await louezDb.db.insert(louezDb.products).values({
          id: productId,
          storeId: STORE,
          name: `Wetsuit ${productId}`,
          price: "10.00",
          pricingMode: "day",
          trackUnits: true,
          bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
          quantity: sizes.length,
        });
        const unitIds = new Map<string, string>();
        for (const [index, size] of sizes.entries()) {
          const name = `${size}${sizes.slice(0, index + 1).filter((s) => s === size).length}`;
          const unitId = nextId("rs_unt");
          unitIds.set(name, unitId);
          await louezDb.db.insert(louezDb.productUnits).values({
            id: unitId,
            productId,
            identifier: name,
            attributes: { size },
            combinationKey: `size:${size}`,
          });
        }
        /** A line of `quantity`, of `size` exactly or of any size, holding the units named. */
        const line = async (
          reservationId: string,
          quantity: number,
          size: string | null,
          held: string[],
          createdAt: Date,
        ) => {
          const itemId = nextId("rs_itm");
          await louezDb.db.insert(louezDb.reservationItems).values({
            id: itemId,
            reservationId,
            productId,
            quantity,
            selectedAttributes: size ? { size } : null,
            combinationKey: size ? `size:${size}` : null,
            unitPrice: "10.00",
            depositPerUnit: "0.00",
            totalPrice: "10.00",
            productSnapshot: { name: "Wetsuit", description: null, images: [] },
            createdAt,
          });
          for (const name of held) {
            await louezDb.db.insert(louezDb.reservationItemUnits).values({
              id: nextId("rs_asg"),
              reservationItemId: itemId,
              productUnitId: unitIds.get(name) ?? "",
              identifierSnapshot: name,
            });
          }
          return itemId;
        };
        return { productId, unitIds, line };
      }
      const FIRST = new Date("2030-01-01T00:00:00Z");
      const SECOND = new Date("2030-01-02T00:00:00Z");

      test("its own unassigned units never make a unit it holds owed: the flag books them over", async () => {
        // Two A units, nobody else. Two lines on A, of two and one, each holding an A.
        const { productId, line } = await wetsuit(["A", "A"]);
        const quoteId = await reservation("quote");
        await line(quoteId, 2, "A", ["A1"], FIRST);
        await line(quoteId, 1, "A", ["A2"], SECOND);
        // Both held units fit; the second line's unit is the one the stock lacks.
        const short = {
          productId,
          productName: `Wetsuit ${productId}`,
          combinationKey: "size:A",
          requested: 1,
          available: 0,
        };

        const refusal = await rejects(
          run("updateStatus", confirmation(quoteId), session()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        assert.deepEqual(refusal.data.details, { shortfalls: [short] });
        await nothingWritten(quoteId, "quote");

        const change = await run("updateStatus", confirmation(quoteId, true), session());
        assert.equal(change.to, "confirmed");
        const row = await confirmedRow(quoteId);
        assert.deepEqual(
          { overbooked: row?.overbooked, overbookingShortfalls: row?.overbookingShortfalls },
          { overbooked: true, overbookingShortfalls: [short] },
        );
      });

      test("an exact L line holding an S unit, nobody else, confirms as before", async () => {
        const { line } = await wetsuit(["S", "S", "L", "L"]);
        const quoteId = await reservation("quote");
        await line(quoteId, 1, "L", ["S1"], FIRST);

        const change = await run("updateStatus", confirmation(quoteId), session());
        assert.equal(change.to, "confirmed");
        assert.equal((await confirmedRow(quoteId))?.overbooked, false);
      });

      test("a unit held past what its line asks for, which another booking needs, is refused by name", async () => {
        // One A, one B. A confirmed booking asks the B and has no unit yet.
        const { unitIds, line } = await wetsuit(["A", "B"]);
        await line(await reservation("confirmed"), 1, "B", [], FIRST);
        // The quote asks one unit of any size and holds both.
        const quoteId = await reservation("quote");
        const itemId = await line(quoteId, 1, null, ["A1", "B1"], SECOND);

        for (const allowOverbooking of [undefined, true]) {
          const refusal = await rejects(
            run("updateStatus", confirmation(quoteId, allowOverbooking), session()),
            "RESERVATION_UNITS_UNAVAILABLE",
          );
          assert.deepEqual(refusal.data.details, {
            conflicts: [
              {
                reservationItemId: itemId,
                unitId: unitIds.get("B1"),
                identifier: "B1",
                reason: "owed_to_other_bookings",
              },
            ],
          });
        }
        await nothingWritten(quoteId, "quote");
      });
    });
  });

  // --- Concurrency (lock order: products, then the reservation) ---------------

  test("a confirmation waits for a write that holds the product, then sees it", async () => {
    const productId = await product(1);
    const id = await reservation("pending", { productId });

    const [outcome] = await raceOnOpenTransaction(
      database,
      async (holder) => {
        // A product update takes the product, and the last unit goes.
        await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [productId]);
        await holder.query("UPDATE products SET quantity = 0 WHERE id = ?", [productId]);
      },
      [
        () =>
          run("updateStatus", { id, status: "confirmed" }, session()).then(
            () => "confirmed",
            (error: { data?: { code?: string } }) => error.data?.code,
          ),
      ],
    );
    assert.equal(outcome, "RESERVATION_INSUFFICIENT_CAPACITY");
    assert.equal(await statusOf(id), "pending", "nothing was written");
    assert.equal(feeEffects.length, 0);
    assert.equal((await outbox()).length, 0, "a rolled back change queues no message");
  });

  test("of two confirmations of the last unit at once, one wins", async () => {
    const productId = await product(1);
    const first = await reservation("pending", { productId });
    const second = await reservation("pending", { productId });

    const outcomes = await raceOnLockedRow(database, { table: "products", id: productId }, [
      () =>
        run("updateStatus", { id: first, status: "confirmed" }, session()).then(
          () => "confirmed",
          (error: { data?: { code?: string } }) => error.data?.code,
        ),
      () =>
        run("updateStatus", { id: second, status: "confirmed" }, session()).then(
          () => "confirmed",
          (error: { data?: { code?: string } }) => error.data?.code,
        ),
    ]);
    assert.deepEqual([...outcomes].sort(), ["RESERVATION_INSUFFICIENT_CAPACITY", "confirmed"]);
    const statuses = [await statusOf(first), await statusOf(second)].sort();
    assert.deepEqual(statuses, ["confirmed", "pending"]);
  });

  test("a product added while a confirmation waits starts it over, with the new product locked", async () => {
    const productId = await product(1);
    const added = await product(1);
    const id = await reservation("pending", { productId });

    const [outcome] = await raceOnOpenTransaction(
      database,
      async (holder) => {
        // An edit holds the reservation and adds a line of another product.
        await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
        await holder.query(
          `INSERT INTO reservation_items
             (id, reservation_id, product_id, quantity, unit_price, deposit_per_unit, total_price, product_snapshot)
           VALUES (?, ?, ?, 1, '10.00', '0.00', '10.00', ?)`,
          [
            nextId("rs_itm"),
            id,
            added,
            JSON.stringify({ name: "Paddle", description: null, images: [] }),
          ],
        );
      },
      [
        () =>
          run("updateStatus", { id, status: "confirmed" }, session()).then((change) => change.to),
      ],
    );
    assert.equal(outcome, "confirmed");
    assert.equal(await statusOf(id), "confirmed");
  });
});
