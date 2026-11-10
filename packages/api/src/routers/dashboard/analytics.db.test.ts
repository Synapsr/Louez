import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "analytics-test-secret";
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
          return id ? { user: { id, email: `${id}@an.test` } } : null;
        },
      },
    },
  },
});

// The statistics procedures end to end through `call()`, on the database. The
// store has no daily_stats or product_stats row, as a store the nightly job
// skipped: every figure comes live from payments and reservations, and equals
// what the dashboard's own queries return.

const OWNER = "an_owner_user_000001";
const STORE = "an_store_a_000000001";
const OTHER_STORE = "an_store_b_000000001";
const CUSTOMER = "an_customer_00000001";
const OTHER_CUSTOMER = "an_customer_00000002";
const TIMEZONE = "Europe/Paris";
const SETTINGS = {
  reservationMode: "request",
  advanceNoticeMinutes: 0,
  currency: "EUR",
  country: "FR",
  timezone: TIMEZONE,
} as const;

/** The store as its sales figures count it. */
const SALES = { id: STORE, currency: "EUR" };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

describe("analytics procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let sales: typeof import("../../services/sales-analytics");
  let salesWindow: typeof import("../../services/sales-window");
  let storeMetrics: typeof import("../../services/store-metrics");
  let router: typeof import("./analytics").dashboardAnalyticsRouter;

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
  };

  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${String(++sequence).padStart(12, "0")}`;

  before(async () => {
    database = await createTestDatabase("api_analytics");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    sales = await import("../../services/sales-analytics");
    salesWindow = await import("../../services/sales-window");
    storeMetrics = await import("../../services/store-metrics");
    ({ dashboardAnalyticsRouter: router } = await import("./analytics"));

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@an.test" });
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "Brest Surf", slug: "an-brest-surf", settings: SETTINGS },
      { id: OTHER_STORE, userId: OWNER, name: "Other", slug: "an-other", settings: SETTINGS },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
    ]);
    await louezDb.db.insert(louezDb.customers).values([
      { id: CUSTOMER, storeId: STORE, email: "ada@an.test", firstName: "Ada", lastName: "L" },
      {
        id: OTHER_CUSTOMER,
        storeId: OTHER_STORE,
        email: "grace@an.test",
        firstName: "Grace",
        lastName: "H",
      },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    const { db } = louezDb;
    for (const table of [
      louezDb.payments,
      louezDb.reservationItems,
      louezDb.reservations,
      louezDb.products,
    ]) {
      await db.delete(table);
    }
  });

  // --- Fixtures -------------------------------------------------------------

  async function product(name: string, store = STORE) {
    const id = nextId("an_prd");
    await louezDb.db.insert(louezDb.products).values({
      id,
      storeId: store,
      name,
      slug: name.toLowerCase(),
      price: "10.00",
      pricingMode: "day",
    });
    return id;
  }

  async function reservation(
    status: "pending" | "confirmed" | "ongoing" | "completed" | "cancelled",
    options: {
      start: Date;
      end?: Date;
      store?: string;
      items?: { productId: string | null; total: string }[];
      currency?: string | null;
    },
  ) {
    const id = nextId("an_res");
    const store = options.store ?? STORE;
    const items = options.items ?? [];
    const total = items.reduce((sum, item) => sum + Number(item.total), 0).toFixed(2);
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: store,
      customerId: store === STORE ? CUSTOMER : OTHER_CUSTOMER,
      number: `R-${sequence}`,
      status,
      startDate: options.start,
      endDate: options.end ?? new Date(options.start.getTime() + DAY),
      subtotalAmount: total,
      depositAmount: "0.00",
      totalAmount: total,
      currency: options.currency === undefined ? "EUR" : options.currency,
      source: "manual",
    });
    for (const item of items) {
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("an_itm"),
        reservationId: id,
        productId: item.productId,
        quantity: 1,
        unitPrice: item.total,
        depositPerUnit: "0.00",
        totalPrice: item.total,
        productSnapshot: { name: "Item", description: null, images: [] },
      });
    }
    return id;
  }

  async function payment(
    reservationId: string,
    amount: string,
    options: {
      method?: "cash" | "card" | "stripe" | "transfer";
      type?: "rental" | "deposit";
      status?: "pending" | "completed";
      paidAt?: Date | null;
      createdAt?: Date;
      currency?: string | null;
    } = {},
  ) {
    await louezDb.db.insert(louezDb.payments).values({
      id: nextId("an_pay"),
      reservationId,
      amount,
      type: options.type ?? "rental",
      method: options.method ?? "cash",
      status: options.status ?? "completed",
      // A few seconds back: timestamps keep whole seconds, and one rounded up
      // past the call's time would fall after the window's end.
      paidAt: options.paidAt === undefined ? ago(5000) : options.paidAt,
      createdAt: options.createdAt ?? ago(5000),
      ...(options.currency === undefined ? {} : { currency: options.currency }),
    });
  }

  // --- Callers --------------------------------------------------------------

  function session(store = STORE) {
    return {
      headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${store}` }),
      transport: "rpc" as const,
      ports,
    };
  }

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  async function apiKey(analytics: "none" | "read") {
    const permissions: Permissions = {
      reservations: "read",
      products: "read",
      customers: "read",
      categories: "read",
      payments: "read",
      analytics,
      settings: "read",
    };
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Figures agent",
      permissions,
    });
    return {
      headers: new Headers({ authorization: `Bearer ${created.key}` }),
      transport: "mcp" as const,
      ports,
    };
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
      path: ["dashboard", "analytics"],
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
  }

  const money = (value: number) => value.toFixed(2);
  const sum = (values: string[]) => values.reduce((total, value) => total + Number(value), 0);

  // --- Live figures -----------------------------------------------------------

  test("a store without daily stats reads today's payments and rentals, as the dashboard counts them", async () => {
    const [nightly] = await louezDb.db
      .select({ rows: orm.count() })
      .from(louezDb.dailyStats)
      .where(orm.eq(louezDb.dailyStats.storeId, STORE));
    assert.equal(nightly?.rows, 0);

    const bike = await product("Bike");
    const kayak = await product("Kayak");
    // A rental that ended yesterday, paid by card two days ago.
    const completed = await reservation("completed", {
      start: ago(3 * DAY),
      end: ago(DAY),
      items: [{ productId: bike, total: "100.00" }],
    });
    await payment(completed, "100.00", { method: "card", paidAt: ago(2 * DAY) });
    // A rental out now, and the 20 € cash recorded for it a moment ago, with
    // no paidAt: it counts on the day it was created.
    const ongoing = await reservation("ongoing", {
      start: ago(HOUR),
      items: [
        { productId: kayak, total: "60.00" },
        { productId: bike, total: "40.00" },
      ],
    });
    await payment(ongoing, "20.00", { method: "cash", paidAt: null });
    // Never revenue: a deposit, a pending payment, another store's payment.
    await payment(ongoing, "300.00", { type: "deposit" });
    await payment(ongoing, "50.00", { status: "pending" });
    const foreign = await reservation("completed", { start: ago(DAY), store: OTHER_STORE });
    await payment(foreign, "500.00");

    const report = await run("getRevenueReport", { period: "30d" }, session());
    const window = salesWindow.getSalesWindow("30d", new Date(), TIMEZONE);
    const [payments, bookings, methods] = await Promise.all([
      sales.getSalesPaymentStats(SALES, window),
      sales.getPeriodReservationStats(STORE, window),
      sales.getRevenueByPaymentMethod(SALES, window),
    ]);
    assert.equal(report.revenue, "120.00");
    assert.equal(report.revenue, money(payments.periodRevenue));
    assert.equal(report.paymentCount, payments.periodPaymentCount);
    assert.equal(report.averagePayment, money(payments.avgPaymentValue));
    assert.equal(report.reservations, 2);
    assert.equal(report.reservations, bookings.reservationCount);
    assert.equal(report.currency, "EUR");
    assert.deepEqual(report.otherCurrencies, []);
    assert.equal(report.window.period, "30d");
    assert.equal(report.window.timezone, TIMEZONE);
    assert.equal(+report.window.start, +window.start);
    assert.deepEqual(
      report.byPaymentMethod.map(({ method, revenue }) => [method, revenue]),
      [
        ["card", "100.00"],
        ["cash", "20.00"],
      ],
    );
    assert.equal(
      sum(report.byPaymentMethod.map((row) => row.revenue)),
      sum(methods.map((row) => money(row.amount))),
    );
    assert.equal(report.breakdown.length, 30);
    assert.equal(sum(report.breakdown.map((day) => day.revenue)), 120);
    // Today is the last day, with the cash payment in it.
    assert.equal(report.breakdown.at(-1)?.revenue, "20.00");
    assert.equal(
      report.links.dashboard,
      `${TEST_APP_URL}/dashboard/analytics/sales?period=30d&store=${STORE}`,
    );

    const stats = await run("getDashboardStats", {}, session());
    const home = await storeMetrics.getStoreMetrics(SALES, { timezone: TIMEZONE });
    assert.equal(stats.today.revenue, "20.00");
    assert.equal(stats.today.revenue, money(home.todaysRevenue));
    assert.equal(stats.revenue.monthToDate, money(home.monthlyRevenue));
    assert.equal(stats.revenue.lastMonth, money(home.lastMonthRevenue));
    assert.equal(stats.revenue.allTime, "120.00");
    assert.equal(stats.revenue.allTime, money(home.allTimeRevenue));
    assert.ok(Number(stats.revenue.monthToDate) >= 20);
    assert.equal(stats.today.departures, home.todaysDepartures);
    assert.equal(stats.today.returns, home.todaysReturns);
    assert.deepEqual(stats.reservations, {
      total: 2,
      pending: 0,
      confirmed: 0,
      ongoing: 1,
      completed: 1,
    });
    assert.deepEqual(stats.catalog, { products: 2, activeProducts: 2, draftProducts: 0 });
    assert.equal(stats.customers.total, 1);
    assert.equal(stats.timezone, TIMEZONE);
    assert.equal(+stats.today.start, +home.calendar.todayStart);
    assert.equal(stats.links.dashboard, `${TEST_APP_URL}/dashboard?store=${STORE}`);

    const performance = await run("getProductPerformance", {}, session());
    const table = await sales.getTopProductsByRevenue(SALES, window);
    assert.equal(performance.revenue, "120.00");
    assert.deepEqual(
      performance.products.map((row) => [row.name, row.revenue, row.reservations]),
      table.products.map((row) => [
        row.productName,
        row.totalRevenue,
        Number(row.reservationCount),
      ]),
    );
  });

  // --- Period bounds ----------------------------------------------------------

  test("a custom range runs from the store's midnight to the one after its last day; a payment counts on the day it was cashed in", async () => {
    const bike = await product("Bike");
    const res = await reservation("completed", {
      // 1 March 2026, 00:00 in Paris (UTC+1).
      start: new Date("2026-02-28T23:00:00.000Z"),
      items: [{ productId: bike, total: "100.00" }],
    });
    // Starts on 1 April 2026, 00:00 in Paris (UTC+2): outside March.
    await reservation("confirmed", { start: new Date("2026-03-31T22:00:00.000Z") });
    // 28 February, 23:59:59 in Paris: outside (timestamps keep whole seconds).
    await payment(res, "1.00", { paidAt: new Date("2026-02-28T22:59:59.000Z") });
    // 1 March, 00:00 in Paris: inside.
    await payment(res, "10.00", { paidAt: new Date("2026-02-28T23:00:00.000Z") });
    // 31 March, 23:59:59 in Paris, after the change to summer time: inside.
    await payment(res, "100.00", { paidAt: new Date("2026-03-31T21:59:59.000Z") });
    // 1 April, 00:00 in Paris: outside.
    await payment(res, "1000.00", { paidAt: new Date("2026-03-31T22:00:00.000Z") });
    // Created in March but cashed in April: April's.
    await payment(res, "5000.00", {
      createdAt: new Date("2026-03-10T10:00:00.000Z"),
      paidAt: new Date("2026-04-02T10:00:00.000Z"),
    });

    const march = await run(
      "getRevenueReport",
      { startDate: "2026-03-01", endDate: "2026-03-31" },
      session(),
    );
    assert.equal(march.revenue, "110.00");
    assert.equal(march.paymentCount, 2);
    assert.equal(march.reservations, 1);
    assert.equal(march.window.period, null);
    assert.equal(march.window.start.toISOString(), "2026-02-28T23:00:00.000Z");
    assert.equal(march.window.end.toISOString(), "2026-03-31T22:00:00.000Z");
    // One bucket per day of March, none past it.
    assert.equal(march.breakdown.length, 31);
    assert.equal(march.breakdown[0]?.revenue, "10.00");
    assert.equal(march.breakdown[30]?.revenue, "100.00");
    // February is the window of the same length right before.
    assert.equal(march.revenueGrowth, 10900);
    assert.equal(march.links.dashboard, `${TEST_APP_URL}/dashboard/analytics/sales?store=${STORE}`);

    // A longer range is bucketed by month, cut at its bounds.
    const spring = await run(
      "getRevenueReport",
      { startDate: "2026-02-15", endDate: "2026-06-30" },
      session(),
    );
    assert.deepEqual(
      spring.breakdown.map((month) => month.revenue),
      ["1.00", "110.00", "6000.00", "0.00", "0.00"],
    );

    // A rolling period starts at the store's midnight and ends now.
    const week = await run("getRevenueReport", { period: "7d" }, session());
    const start = week.window.start;
    await payment(res, "7.00", { paidAt: new Date(start.getTime() - 1000) });
    await payment(res, "3.00", { paidAt: start });
    const again = await run("getRevenueReport", { period: "7d" }, session());
    assert.equal(again.revenue, "3.00");
    assert.equal(+again.window.start, +start);
    assert.ok(+again.window.end <= Date.now());

    // A range is two dates, in order, without a period.
    for (const input of [
      { startDate: "2026-03-01" },
      { startDate: "2026-03-31", endDate: "2026-03-01" },
      { period: "30d" as const, startDate: "2026-03-01", endDate: "2026-03-31" },
      { startDate: "2024-01-01", endDate: "2026-03-31" },
      // Days that do not exist are refused, never read as another day.
      { startDate: "2026-02-31", endDate: "2026-03-31" },
      { startDate: "2026-02-01", endDate: "2026-02-29" },
      { startDate: "2026-04-31", endDate: "2026-05-02" },
    ]) {
      await rejects(run("getRevenueReport", input, session()), "BAD_REQUEST");
      await rejects(run("getProductPerformance", input, session()), "BAD_REQUEST");
    }
    // A leap day exists.
    const leap = await run(
      "getRevenueReport",
      { startDate: "2028-02-29", endDate: "2028-02-29" },
      session(),
    );
    assert.equal(leap.window.start.toISOString(), "2028-02-28T23:00:00.000Z");
  });

  // --- Product ranking --------------------------------------------------------

  test("products rank by their share of the payments, as the dashboard's top products table splits them", async () => {
    const bike = await product("Bike");
    const kayak = await product("Kayak");
    const helmet = await product("Helmet");
    await louezDb.db
      .update(louezDb.products)
      .set({ status: "archived" })
      .where(orm.eq(louezDb.products.id, helmet));
    // 150 paid on 300 of items: 100 to the bike, 50 to the kayak.
    const both = await reservation("completed", {
      start: ago(5 * DAY),
      items: [
        { productId: bike, total: "200.00" },
        { productId: kayak, total: "100.00" },
      ],
    });
    await payment(both, "150.00", { paidAt: ago(4 * DAY) });
    const kayakOnly = await reservation("completed", {
      start: ago(3 * DAY),
      items: [{ productId: kayak, total: "100.00" }],
    });
    await payment(kayakOnly, "100.00", { paidAt: ago(2 * DAY) });
    const helmetOnly = await reservation("ongoing", {
      start: ago(DAY),
      items: [{ productId: helmet, total: "10.00" }],
    });
    await payment(helmetOnly, "10.00");
    // An item outside the catalog.
    const custom = await reservation("completed", {
      start: ago(DAY),
      items: [{ productId: null, total: "30.00" }],
    });
    await payment(custom, "30.00");
    // Paid before the window: out of a 7-day ranking.
    const old = await reservation("completed", {
      start: ago(40 * DAY),
      items: [{ productId: bike, total: "999.00" }],
    });
    await payment(old, "999.00", { paidAt: ago(40 * DAY) });

    const ranking = await run("getProductPerformance", { period: "7d", limit: 2 }, session());
    assert.deepEqual(
      ranking.products.map((row) => [row.name, row.revenue, row.reservations, row.quantity]),
      [
        ["Kayak", "150.00", 2, 2],
        ["Bike", "100.00", 1, 1],
      ],
    );
    assert.equal(ranking.productCount, 3);
    assert.equal(ranking.revenue, "290.00");
    assert.equal(ranking.catalogRevenue, "260.00");
    assert.equal(ranking.nonCatalogRevenue, "30.00");
    assert.equal(ranking.unallocatedRevenue, "0.00");
    assert.equal(
      ranking.products[0]?.links.dashboard,
      `${TEST_APP_URL}/dashboard/products/${kayak}?store=${STORE}`,
    );

    // The same rows as the dashboard's table, ranked the same way.
    const window = salesWindow.getSalesWindow("7d", new Date(), TIMEZONE);
    const table = await sales.getTopProductsByRevenue(SALES, window, 2);
    assert.deepEqual(
      ranking.products.map((row) => [row.id, row.revenue]),
      table.products.map((row) => [row.productId, row.totalRevenue]),
    );

    // Every product, the archived one included, by default.
    const all = await run("getProductPerformance", { period: "7d" }, session());
    assert.deepEqual(
      all.products.map((row) => row.name),
      ["Kayak", "Bike", "Helmet"],
    );
    // The old payment joins over 90 days.
    const quarter = await run("getProductPerformance", { period: "90d" }, session());
    assert.equal(quarter.products[0]?.name, "Bike");
    assert.equal(quarter.products[0]?.revenue, "1099.00");
  });

  // --- Currency ---------------------------------------------------------------

  test("totals count only the store's current currency; payments in another one are listed apart", async () => {
    const bike = await product("Bike");
    // Paid in pounds before the store moved to euros.
    const before = await reservation("completed", {
      start: ago(5 * DAY),
      items: [{ productId: bike, total: "100.00" }],
      currency: "GBP",
    });
    await payment(before, "100.00", { paidAt: ago(4 * DAY), currency: "GBP" });
    // No currency on the payment: its reservation's, pounds.
    await payment(before, "40.00", { paidAt: ago(4 * DAY), currency: null });
    // A reservation from before currencies were frozen: the store's.
    const legacy = await reservation("completed", {
      start: ago(3 * DAY),
      items: [{ productId: bike, total: "25.00" }],
      currency: null,
    });
    await payment(legacy, "25.00", { paidAt: ago(2 * DAY), currency: null });
    const swiss = await reservation("completed", { start: ago(DAY) });
    await payment(swiss, "7.50", { currency: "CHF" });
    const euros = await reservation("completed", {
      start: ago(DAY),
      items: [{ productId: bike, total: "60.00" }],
    });
    await payment(euros, "60.00", { currency: "eur" });

    const pounds = [
      { currency: "CHF", amount: "7.50", paymentCount: 1 },
      { currency: "GBP", amount: "140.00", paymentCount: 2 },
    ];
    const report = await run("getRevenueReport", { period: "7d" }, session());
    assert.equal(report.currency, "EUR");
    assert.equal(report.revenue, "85.00");
    assert.equal(report.paymentCount, 2);
    assert.equal(sum(report.breakdown.map((day) => day.revenue)), 85);
    assert.equal(sum(report.byPaymentMethod.map((row) => row.revenue)), 85);
    assert.deepEqual(report.otherCurrencies, pounds);

    const ranking = await run("getProductPerformance", { period: "7d" }, session());
    assert.equal(ranking.revenue, "85.00");
    assert.deepEqual(
      ranking.products.map((row) => [row.name, row.revenue]),
      [["Bike", "85.00"]],
    );
    assert.deepEqual(ranking.otherCurrencies, pounds);

    const stats = await run("getDashboardStats", {}, session());
    assert.equal(stats.revenue.allTime, "85.00");
    assert.deepEqual(stats.otherCurrencies, pounds);

    // The dashboard counts the same way.
    const window = salesWindow.getSalesWindow("7d", new Date(), TIMEZONE);
    const dashboard = await sales.getSalesPaymentStats(SALES, window);
    assert.equal(money(dashboard.periodRevenue), report.revenue);

    // A store that moved to pounds counts the pounds, and lists the rest. The
    // receipt with no currency anywhere takes the store's, now pounds.
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: { ...SETTINGS, currency: "GBP" } })
      .where(orm.eq(louezDb.stores.id, STORE));
    try {
      const inPounds = await run("getRevenueReport", { period: "7d" }, session());
      assert.equal(inPounds.currency, "GBP");
      assert.equal(inPounds.revenue, "165.00");
      assert.deepEqual(inPounds.otherCurrencies, [
        { currency: "CHF", amount: "7.50", paymentCount: 1 },
        { currency: "EUR", amount: "60.00", paymentCount: 1 },
      ]);
    } finally {
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: SETTINGS })
        .where(orm.eq(louezDb.stores.id, STORE));
    }
  });

  // --- Deprecated input -------------------------------------------------------

  test("get_dashboard_stats refuses the period it once took, rather than ignoring it", async () => {
    let caught: unknown;
    try {
      await run("getDashboardStats", { period: "7d" }, session());
    } catch (error) {
      caught = error;
    }
    const { code, data } = (caught ?? {}) as {
      code?: string;
      data?: { issues?: { path?: unknown[]; message?: string }[] };
    };
    assert.equal(code, "BAD_REQUEST", String(caught));
    const issue = data?.issues?.[0];
    assert.deepEqual(issue?.path, ["period"]);
    assert.match(issue?.message ?? "", /get_revenue_report or get_product_performance/);
    // Any other unknown field is still dropped, as everywhere.
    const stats = await run("getDashboardStats", { verbose: true }, session());
    assert.equal(stats.currency, "EUR");
  });

  // --- Rights -----------------------------------------------------------------

  test("an agent reads the figures with analytics read, and is refused without it", async () => {
    const res = await reservation("completed", { start: ago(DAY) });
    await payment(res, "42.00");
    const reader = await apiKey("read");
    const report = await run("getRevenueReport", {}, reader);
    assert.equal(report.revenue, "42.00");
    assert.equal(report.window.period, "30d");
    const blind = await apiKey("none");
    for (const name of [
      "getDashboardStats",
      "getRevenueReport",
      "getProductPerformance",
    ] as const) {
      await rejects(run(name, {}, blind), "PERMISSION_DENIED");
    }
  });
});
