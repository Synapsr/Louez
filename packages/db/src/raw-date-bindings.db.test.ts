import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "./testing/test-database";

// A `Date` bound to a raw SQL expression has no column to encode it, so mysql2
// writes it itself. It must write it in UTC, as Drizzle writes every timestamp
// column, whatever the time zone of the process: the overlap predicate compares
// such a `Date` with a booking's end.

const STORE = "store_raw_dates";
/** Ends at 10:00 UTC: a window that starts at 09:00 UTC overlaps it. */
const OVERLAPPING = "res_ends_at_ten";
/** Ends at 05:00 UTC: a window that starts at 09:00 UTC does not. */
const OVER = "res_ends_at_five";
const WINDOW = {
  start: new Date("2031-06-10T09:00:00.000Z"),
  end: new Date("2031-06-10T18:00:00.000Z"),
  turnoverBufferMinutes: 0,
};
/** Ahead of UTC, behind it, and UTC itself. */
const TIME_ZONES = ["Pacific/Kiritimati", "America/Los_Angeles", "Europe/Paris", "UTC"];

describe("a Date bound to raw SQL (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("./index");
  const processTimeZone = process.env.TZ;

  before(async () => {
    database = await createTestDatabase("raw_date_bindings");
    // DATABASE_URL now points at the test database.
    louezDb = await import("./index");
    const booking = (id: string, endDate: string) => ({
      id,
      storeId: STORE,
      customerId: "customer_raw_dates",
      number: id,
      // A fixture, so it may start in any status.
      status: "confirmed" as const,
      startDate: new Date("2031-06-10T02:00:00.000Z"),
      endDate: new Date(endDate),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
    await louezDb.db
      .insert(louezDb.reservations)
      .values([
        booking(OVERLAPPING, "2031-06-10T10:00:00.000Z"),
        booking(OVER, "2031-06-10T05:00:00.000Z"),
      ]);
  });

  after(async () => {
    if (processTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = processTimeZone;
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  for (const timeZone of TIME_ZONES) {
    test(`the overlap window is the same instant with the process in ${timeZone}`, async () => {
      process.env.TZ = timeZone;

      const overlapping = await louezDb.db
        .select({ id: louezDb.reservations.id })
        .from(louezDb.reservations)
        .where(louezDb.buildReservationOverlapPredicate(WINDOW));

      assert.deepEqual(
        overlapping.map((row) => row.id),
        [OVERLAPPING],
      );
    });
  }
});
