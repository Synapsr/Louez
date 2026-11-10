import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { enGB } from "date-fns/locale";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The multi-store revenue chart counts each store as its sales page does: the
// period cut at the store's own midnights (calendar months for 6m and 12m),
// whatever the server's time zone, and each store in its own currency.

const OWNER = "ms_owner_00000000001";
const PARIS = "ms_store_paris_00001";
const NEW_YORK = "ms_store_newyork_001";

// Tuesday 10 November 2026, 16:00 in Paris (UTC+1), 10:00 in New York (UTC-5).
const NOW = new Date("2026-11-10T15:00:00.000Z");

describe("multi-store revenue chart (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let metrics: typeof import("./multi-store-metrics");
  let sequence = 0;

  async function receipt(storeId: string, amount: string, paidAt: Date) {
    const reservationId = `ms_res_${String(++sequence).padStart(14, "0")}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId,
      customerId: `${storeId}_c`.slice(0, 21),
      number: `R-${sequence}`,
      status: "completed",
      startDate: paidAt,
      endDate: paidAt,
      subtotalAmount: amount,
      depositAmount: "0.00",
      totalAmount: amount,
      currency: null,
    });
    await louezDb.db.insert(louezDb.payments).values({
      reservationId,
      amount,
      type: "rental",
      method: "card",
      status: "completed",
      currency: null,
      paidAt,
    });
  }

  before(async () => {
    database = await createTestDatabase("multi_store_trend");
    louezDb = await import("@louez/db");
    metrics = await import("./multi-store-metrics");
    const { db } = louezDb;

    await db.insert(louezDb.users).values({ id: OWNER, email: "owner@ms.test" });
    const store = (id: string, name: string, timezone: string, currency: string) => ({
      id,
      userId: OWNER,
      name,
      slug: name.toLowerCase().replaceAll(" ", "-"),
      settings: {
        reservationMode: "request" as const,
        advanceNoticeMinutes: 0,
        timezone,
        currency,
      },
    });
    await db
      .insert(louezDb.stores)
      .values([
        store(PARIS, "Paris", "Europe/Paris", "EUR"),
        store(NEW_YORK, "New York", "America/New_York", "USD"),
      ]);
    for (const storeId of [PARIS, NEW_YORK]) {
      await db.insert(louezDb.customers).values({
        id: `${storeId}_c`.slice(0, 21),
        storeId,
        email: `${storeId}@ms.test`,
        firstName: "Ada",
        lastName: "L",
      });
    }

    // 7d starts on 4 November, at each store's midnight.
    await receipt(PARIS, "1.00", new Date("2026-11-03T22:59:59.000Z")); // 3 Nov, 23:59:59 Paris: out
    await receipt(PARIS, "10.00", new Date("2026-11-03T23:30:00.000Z")); // 4 Nov, 00:30 Paris: in
    await receipt(NEW_YORK, "2.00", new Date("2026-11-04T04:59:59.000Z")); // 3 Nov, 23:59:59 NY: out
    await receipt(NEW_YORK, "20.00", new Date("2026-11-04T05:30:00.000Z")); // 4 Nov, 00:30 NY: in
    // 6m starts on 1 June, not 180 days back.
    await receipt(PARIS, "100.00", new Date("2026-05-31T21:59:59.000Z")); // 31 May, Paris: out
    await receipt(PARIS, "300.00", new Date("2026-05-31T22:30:00.000Z")); // 1 June, 00:30 Paris: in
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("each store's days start at its own midnight, and each store keeps its currency", async () => {
    const trend = await metrics.getMultiStoreRevenueTrend([PARIS, NEW_YORK], "7d", enGB, 6, NOW);
    assert.deepEqual(
      trend.data.map((point) => point.date),
      [
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
        "2026-11-07",
        "2026-11-08",
        "2026-11-09",
        "2026-11-10",
      ],
    );
    assert.equal(trend.data[0]?.Paris, 10);
    assert.equal(trend.data[0]?.["New York"], 20);
    const total = (name: string) =>
      trend.data.reduce((sum, point) => sum + Number(point[name] ?? 0), 0);
    assert.equal(total("Paris"), 10);
    assert.equal(total("New York"), 20);
    assert.deepEqual(trend.storeCurrencies, { "New York": "USD", Paris: "EUR" });
  });

  test("6m is the store's six calendar months, the current one included", async () => {
    const trend = await metrics.getMultiStoreRevenueTrend([PARIS, NEW_YORK], "6m", enGB, 6, NOW);
    assert.deepEqual(
      trend.data.map((point) => point.date),
      ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"],
    );
    assert.equal(trend.data[0]?.Paris, 300);
    assert.equal(trend.data[0]?.label, "Jun 26");
    // November holds the 3 November receipts too.
    assert.equal(trend.data.at(-1)?.Paris, 11);
    assert.equal(trend.data.at(-1)?.["New York"], 22);
  });
});
