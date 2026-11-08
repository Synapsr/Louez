import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { startOfDay, subDays } from "date-fns";
import { and, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// Product revenue in product_stats (read by the get_product_performance MCP tool):
// the day's rental receipts, split across a reservation's items by price, refunds
// excluded, as the product page counts them.

type Insert<Table extends keyof typeof import("@louez/db")> =
  (typeof import("@louez/db"))[Table] extends { $inferInsert: infer Row } ? Row : never;

const STORE = "store_pstats";
const OTHER_STORE = "store_pstats_other";

describe("product stats revenue (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let aggregation: typeof import("./aggregation");

  const yesterday = startOfDay(subDays(new Date(), 1));
  const yesterdayNoon = new Date(yesterday.getTime() + 12 * 60 * 60 * 1000);
  const today = startOfDay(new Date());
  const twoDaysAgo = subDays(yesterdayNoon, 1);

  before(async () => {
    database = await createTestDatabase("product_stats_revenue");
    louezDb = await import("@louez/db");
    aggregation = await import("./aggregation");
    const { db } = louezDb;

    await db.insert(louezDb.users).values({ id: "u_stats", email: "owner@stats.test" });
    await db.insert(louezDb.stores).values(
      [STORE, OTHER_STORE].map((id) => ({
        id,
        userId: "u_stats",
        name: id,
        slug: id.replaceAll("_", "-"),
        onboardingCompleted: true,
      })),
    );
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
        product("prod_other", OTHER_STORE),
      ]);

    const reservation = (id: string, storeId = STORE): Insert<"reservations"> => ({
      id,
      storeId,
      customerId: "customer",
      number: id,
      status: "confirmed",
      startDate: yesterdayNoon,
      endDate: today,
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
    });
    await db
      .insert(louezDb.reservations)
      .values([
        reservation("res_paid"),
        reservation("res_old"),
        reservation("res_other", OTHER_STORE),
      ]);

    const item = (
      reservationId: string,
      productId: string,
      totalPrice: string,
    ): Insert<"reservationItems"> => ({
      reservationId,
      productId,
      quantity: 1,
      unitPrice: totalPrice,
      depositPerUnit: "0.00",
      totalPrice,
      productSnapshot: { name: productId, description: null, images: [] },
    });
    await db
      .insert(louezDb.reservationItems)
      .values([
        item("res_paid", "prod_bike", "60.00"),
        item("res_paid", "prod_helmet", "40.00"),
        item("res_old", "prod_bike", "100.00"),
        item("res_other", "prod_other", "100.00"),
      ]);

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
      paidAt,
      ...extra,
    });
    await db.insert(louezDb.payments).values([
      // 100 cashed in yesterday, split 60/40 between the bike and the helmet.
      payment("pay_rental", "res_paid", "100.00", yesterdayNoon),
      // A manual refund of 20 is not a receipt: the receipt row itself stays at 100.
      payment("pay_refund", "res_paid", "20.00", yesterdayNoon, {
        refundOfPaymentId: "pay_rental",
      }),
      // A deposit is not rental revenue.
      payment("pay_deposit", "res_paid", "300.00", yesterdayNoon, { type: "deposit" }),
      // A pending payment has not been received.
      payment("pay_pending", "res_paid", "50.00", yesterdayNoon, { status: "pending" }),
      // Cashed in two days ago: another day's revenue.
      payment("pay_old", "res_old", "100.00", twoDaysAgo),
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

  test("a day's receipts are split across the reservation's products by price", async () => {
    const receipts = await aggregation.getProductReceipts(STORE, yesterday, today);
    assert.deepEqual(Object.fromEntries(receipts), { prod_bike: 60, prod_helmet: 40 });
  });

  test("the daily aggregation records each product's revenue", async () => {
    await aggregation.aggregateDailyAnalytics();
    // A second run updates the same rows.
    await aggregation.aggregateDailyAnalytics();

    const rows = await louezDb.db
      .select({
        productId: louezDb.productStats.productId,
        views: louezDb.productStats.views,
        revenue: louezDb.productStats.revenue,
      })
      .from(louezDb.productStats)
      .where(
        and(eq(louezDb.productStats.storeId, STORE), eq(louezDb.productStats.date, yesterday)),
      );
    const byProduct = Object.fromEntries(
      rows.map((row) => [row.productId, { views: row.views, revenue: row.revenue }]),
    );
    assert.deepEqual(byProduct, {
      prod_bike: { views: 0, revenue: "60.00" },
      prod_helmet: { views: 0, revenue: "40.00" },
      prod_viewed: { views: 1, revenue: "0.00" },
    });
  });
});
