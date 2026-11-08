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

process.env.AUTH_SECRET ??= "reservations-test-secret";
process.env.NODE_ENV = "test";

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
      .orderBy(louezDb.apiEffects.createdAt, louezDb.apiEffects.type);
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

  test("a later status change supersedes the earlier customer message still unsent", async () => {
    const id = await reservation("pending", { productId: await product() });
    await run("updateStatus", { id, status: "confirmed" }, session());
    await run("cancel", { id }, session());
    const messages = (await outbox()).filter((row) => row.type === "reservation.customerMessage");
    assert.deepEqual(
      messages.map((row) => row.status),
      ["superseded"],
      "the acceptance email speaks of a status no longer true",
    );
    const storeRows = (await outbox()).filter(
      (row) => row.type === "reservation.storeNotification",
    );
    assert.equal(storeRows.length, 6, "the store hears of both changes, in order");
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
    assert.deepEqual(preview.details.messages, []);
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
    assert.equal(outcome, "RESERVATION_ITEMS_UNAVAILABLE");
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
    assert.deepEqual([...outcomes].sort(), ["RESERVATION_ITEMS_UNAVAILABLE", "confirmed"]);
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
