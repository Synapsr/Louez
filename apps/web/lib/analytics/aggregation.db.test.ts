import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { startOfDay, subDays } from "date-fns";
import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// Product revenue in product_stats (read by the get_product_performance MCP tool):
// each rental receipt counts on the day it was cashed in, at its current amount,
// split across its reservation's items by price in whole cents, in the store's
// currency, as the product page counts it. Every run recomputes the window, so a
// refund or a deleted payment brings an earlier day back down.

type Insert<Table extends keyof typeof import("@louez/db")> =
  (typeof import("@louez/db"))[Table] extends { $inferInsert: infer Row } ? Row : never;

const STORE = "store_pstats";
const OTHER_STORE = "store_pstats_other";

describe("product stats revenue (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let aggregation: typeof import("./aggregation");
  let productRevenue: typeof import("./product-revenue");

  // A fixed clock: the run aggregates the day before NOW.
  const NOW = new Date(2027, 2, 15, 10, 0, 0);
  const yesterday = startOfDay(subDays(NOW, 1));
  const yesterdayNoon = new Date(yesterday.getTime() + 12 * 60 * 60 * 1000);
  const today = startOfDay(NOW);
  const tenDaysAgo = startOfDay(subDays(NOW, 10));
  const tenDaysAgoNoon = new Date(tenDaysAgo.getTime() + 12 * 60 * 60 * 1000);

  const reservation = (
    id: string,
    storeId = STORE,
    currency: string | null = null,
  ): Insert<"reservations"> => ({
    id,
    storeId,
    currency,
    customerId: "customer",
    number: id,
    status: "confirmed",
    startDate: yesterdayNoon,
    endDate: today,
    subtotalAmount: "100.00",
    depositAmount: "0.00",
    totalAmount: "100.00",
  });
  const item = (
    reservationId: string,
    productId: string | null,
    totalPrice: string,
    id?: string,
  ): Insert<"reservationItems"> => ({
    id,
    reservationId,
    productId,
    isCustomItem: productId === null,
    quantity: 1,
    unitPrice: totalPrice,
    depositPerUnit: "0.00",
    totalPrice,
    productSnapshot: { name: productId ?? "custom", description: null, images: [] },
  });
  const payment = (
    id: string,
    reservationId: string,
    amount: string,
    paidAt: Date,
    extra: Partial<Insert<"payments">> = {},
  ): Insert<"payments"> => ({
    id,
    reservationId,
    amount,
    type: "rental",
    method: "card",
    status: "completed",
    currency: "EUR",
    paidAt,
    ...extra,
  });

  const readStats = async () => {
    const rows = await louezDb.db
      .select({
        productId: louezDb.productStats.productId,
        date: louezDb.productStats.date,
        views: louezDb.productStats.views,
        revenue: louezDb.productStats.revenue,
      })
      .from(louezDb.productStats)
      .where(eq(louezDb.productStats.storeId, STORE));
    return Object.fromEntries(
      rows.map((row) => [
        `${row.date.getTime() === yesterday.getTime() ? "yesterday" : row.date.getTime() === tenDaysAgo.getTime() ? "tenDaysAgo" : row.date.toISOString()}:${row.productId}`,
        { views: row.views, revenue: row.revenue },
      ]),
    );
  };

  before(async () => {
    database = await createTestDatabase("product_stats_revenue");
    louezDb = await import("@louez/db");
    aggregation = await import("./aggregation");
    productRevenue = await import("./product-revenue");
    const { db } = louezDb;

    await db.insert(louezDb.users).values({ id: "u_stats", email: "owner@stats.test" });
    const store = (id: string): Insert<"stores"> => ({
      id,
      userId: "u_stats",
      name: id,
      slug: id.replaceAll("_", "-"),
      onboardingCompleted: true,
      settings: { reservationMode: "payment", advanceNoticeMinutes: 0, currency: "EUR" },
    });
    await db.insert(louezDb.stores).values([store(STORE), store(OTHER_STORE)]);
    const product = (id: string, storeId = STORE): Insert<"products"> => ({
      id,
      storeId,
      name: id,
      price: "10.00",
      pricingMode: "day",
    });
    await db
      .insert(louezDb.products)
      .values([
        product("prod_bike"),
        product("prod_helmet"),
        product("prod_viewed"),
        product("prod_a"),
        product("prod_b"),
        product("prod_c"),
        product("prod_other", OTHER_STORE),
      ]);

    await db
      .insert(louezDb.reservations)
      .values([
        reservation("res_paid"),
        reservation("res_thirds"),
        reservation("res_custom"),
        reservation("res_usd"),
        reservation("res_gbp", STORE, "GBP"),
        reservation("res_old"),
        reservation("res_other", OTHER_STORE),
      ]);
    await db.insert(louezDb.reservationItems).values([
      item("res_paid", "prod_bike", "60.00"),
      item("res_paid", "prod_helmet", "40.00"),
      // Equal shares: the extra cent goes to the smallest item id.
      item("res_thirds", "prod_a", "10.00", "item_thirds_c"),
      item("res_thirds", "prod_b", "10.00", "item_thirds_b"),
      item("res_thirds", "prod_c", "10.00", "item_thirds_a"),
      // A custom item takes its share of the receipt, counted for no product.
      item("res_custom", "prod_bike", "50.00"),
      item("res_custom", null, "50.00"),
      item("res_usd", "prod_bike", "100.00"),
      item("res_gbp", "prod_bike", "100.00"),
      item("res_old", "prod_helmet", "100.00"),
      item("res_other", "prod_other", "100.00"),
    ]);

    await db.insert(louezDb.payments).values([
      // 100 cashed in yesterday, split 60/40 between the bike and the helmet.
      payment("pay_rental", "res_paid", "100.00", yesterdayNoon),
      // A manual refund row is not a receipt.
      payment("pay_refund", "res_paid", "20.00", yesterdayNoon, {
        refundOfPaymentId: "pay_rental",
      }),
      // A deposit is not rental revenue, and a pending payment was not received.
      payment("pay_deposit", "res_paid", "300.00", yesterdayNoon, { type: "deposit" }),
      payment("pay_pending", "res_paid", "50.00", yesterdayNoon, { status: "pending" }),
      // €1 over three equal products: 0.33, 0.33 and 0.34, never 0.99 in all.
      payment("pay_thirds", "res_thirds", "1.00", yesterdayNoon),
      // Half of this one goes to a custom item.
      payment("pay_custom", "res_custom", "10.00", yesterdayNoon),
      // A receipt in another currency than the store's is left out.
      payment("pay_usd", "res_usd", "100.00", yesterdayNoon, { currency: "USD" }),
      // Without a currency of its own, a receipt is in its reservation's: GBP here.
      payment("pay_gbp", "res_gbp", "100.00", yesterdayNoon, { currency: null }),
      // Cashed in ten days ago: that day's revenue.
      payment("pay_old", "res_old", "100.00", tenDaysAgoNoon),
      // Another store's sale.
      payment("pay_other", "res_other", "100.00", yesterdayNoon),
    ]);

    await db.insert(louezDb.pageViews).values({
      storeId: STORE,
      sessionId: "session_stats",
      page: "product",
      productId: "prod_viewed",
      createdAt: yesterdayNoon,
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("receipts are split per day and product in whole cents, in the store's currency", async () => {
    const revenue = await productRevenue.getProductRevenueByDay({
      storeId: STORE,
      currency: "EUR",
      start: tenDaysAgo,
      end: today,
    });
    assert.deepEqual(Object.fromEntries(revenue.byDay.get(yesterday.getTime()) ?? []), {
      prod_bike: 6500,
      prod_helmet: 4000,
      prod_a: 33,
      prod_b: 33,
      prod_c: 34,
    });
    assert.deepEqual(Object.fromEntries(revenue.byDay.get(tenDaysAgo.getTime()) ?? []), {
      prod_helmet: 10_000,
    });
    assert.deepEqual(
      [...revenue.skipped].sort((a, b) => a.currency.localeCompare(b.currency)),
      [
        { currency: "GBP", count: 1 },
        { currency: "USD", count: 1 },
      ],
    );
  });

  test("the daily aggregation records each product's revenue on its receipt day", async () => {
    await aggregation.aggregateDailyAnalytics(NOW);
    // A second run writes the same figures.
    await aggregation.aggregateDailyAnalytics(NOW);

    assert.deepEqual(await readStats(), {
      "yesterday:prod_bike": { views: 0, revenue: "65.00" },
      "yesterday:prod_helmet": { views: 0, revenue: "40.00" },
      "yesterday:prod_a": { views: 0, revenue: "0.33" },
      "yesterday:prod_b": { views: 0, revenue: "0.33" },
      "yesterday:prod_c": { views: 0, revenue: "0.34" },
      "yesterday:prod_viewed": { views: 1, revenue: "0.00" },
      "tenDaysAgo:prod_helmet": { views: 0, revenue: "100.00" },
    });
  });

  test("a later full refund or a deleted payment brings its day back to zero", async () => {
    const { db, payments } = louezDb;
    // A full Stripe refund brings the charge row down to what the store keeps.
    await db.update(payments).set({ amount: "0.00" }).where(eq(payments.id, "pay_rental"));
    await db.delete(payments).where(eq(payments.id, "pay_old"));

    await aggregation.aggregateDailyAnalytics(NOW);

    const stats = await readStats();
    assert.deepEqual(stats["yesterday:prod_bike"], { views: 0, revenue: "5.00" });
    assert.deepEqual(stats["yesterday:prod_helmet"], { views: 0, revenue: "0.00" });
    assert.deepEqual(stats["tenDaysAgo:prod_helmet"], { views: 0, revenue: "0.00" });
    assert.deepEqual(stats["yesterday:prod_viewed"], { views: 1, revenue: "0.00" });
  });
});
