import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { startOfDay, subDays } from "date-fns";
import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The nightly job rolls up yesterday's storefront traffic for the traffic page.
// Sales are not rolled up: the dashboard and the statistics procedures read
// them live from payments, so a payment leaves the stats tables' revenue and
// reservations at their defaults.

const STORE = "store_traffic";
const PRODUCT = "prod_traffic";

describe("daily traffic aggregation (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let aggregation: typeof import("./aggregation");

  // A fixed clock: the run aggregates the day before NOW.
  const NOW = new Date(2027, 2, 15, 10, 0, 0);
  const yesterday = startOfDay(subDays(NOW, 1));
  const yesterdayNoon = new Date(yesterday.getTime() + 12 * 60 * 60 * 1000);

  before(async () => {
    database = await createTestDatabase("daily_traffic");
    louezDb = await import("@louez/db");
    aggregation = await import("./aggregation");
    const { db } = louezDb;

    await db.insert(louezDb.users).values({ id: "u_traffic", email: "owner@traffic.test" });
    await db.insert(louezDb.stores).values({
      id: STORE,
      userId: "u_traffic",
      name: "Traffic",
      slug: "traffic",
      onboardingCompleted: true,
      settings: { reservationMode: "payment", advanceNoticeMinutes: 0, currency: "EUR" },
    });
    await db.insert(louezDb.products).values({
      id: PRODUCT,
      storeId: STORE,
      name: "Bike",
      price: "10.00",
      pricingMode: "day",
    });
    await db.insert(louezDb.pageViews).values([
      {
        storeId: STORE,
        sessionId: "session-a",
        page: "home",
        device: "mobile",
        createdAt: yesterdayNoon,
      },
      {
        storeId: STORE,
        sessionId: "session-a",
        page: "product",
        productId: PRODUCT,
        device: "mobile",
        createdAt: yesterdayNoon,
      },
    ]);
    await db.insert(louezDb.storefrontEvents).values({
      storeId: STORE,
      sessionId: "session-a",
      eventType: "add_to_cart",
      metadata: { productId: PRODUCT },
      createdAt: yesterdayNoon,
    });
    // A rental paid yesterday: money the job no longer rolls up.
    await db.insert(louezDb.customers).values({
      id: "cust_traffic",
      storeId: STORE,
      email: "ada@traffic.test",
      firstName: "Ada",
      lastName: "L",
    });
    await db.insert(louezDb.reservations).values({
      id: "res_traffic",
      storeId: STORE,
      customerId: "cust_traffic",
      number: "R-1",
      status: "confirmed",
      startDate: yesterdayNoon,
      endDate: NOW,
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
      createdAt: yesterdayNoon,
    });
    await db.insert(louezDb.reservationItems).values({
      reservationId: "res_traffic",
      productId: PRODUCT,
      quantity: 1,
      unitPrice: "100.00",
      depositPerUnit: "0.00",
      totalPrice: "100.00",
      productSnapshot: { name: "Bike", description: null, images: [] },
    });
    await db.insert(louezDb.payments).values({
      reservationId: "res_traffic",
      amount: "100.00",
      type: "rental",
      method: "card",
      status: "completed",
      currency: "EUR",
      paidAt: yesterdayNoon,
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("the daily aggregation records yesterday's traffic, and no sales", async () => {
    await aggregation.aggregateDailyAnalytics(NOW);
    // A second run writes the same figures.
    await aggregation.aggregateDailyAnalytics(NOW);

    const days = await louezDb.db
      .select()
      .from(louezDb.dailyStats)
      .where(eq(louezDb.dailyStats.storeId, STORE));
    assert.equal(days.length, 1);
    const [day] = days;
    assert.equal(day?.date.getTime(), yesterday.getTime());
    assert.equal(day?.pageViews, 2);
    assert.equal(day?.uniqueVisitors, 1);
    assert.equal(day?.productViews, 1);
    assert.equal(day?.mobileVisitors, 1);
    assert.equal(day?.cartAdditions, 1);
    assert.equal(day?.reservationsCreated, 1);
    assert.equal(day?.revenue, "0.00");
    assert.equal(day?.averageCartValue, "0.00");

    const products = await louezDb.db
      .select()
      .from(louezDb.productStats)
      .where(eq(louezDb.productStats.storeId, STORE));
    assert.deepEqual(
      products.map((row) => ({
        productId: row.productId,
        views: row.views,
        cartAdditions: row.cartAdditions,
        reservations: row.reservations,
        revenue: row.revenue,
      })),
      [{ productId: PRODUCT, views: 1, cartAdditions: 1, reservations: 0, revenue: "0.00" }],
    );
  });
});
