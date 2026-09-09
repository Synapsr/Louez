import assert from "node:assert/strict";
import { test } from "node:test";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  getReservationAvailabilityEnd,
  buildReservationOverlapPredicate,
} from "./unit-availability";
const endDate = new Date("2030-01-01");
const requestedEndMs = new Date("2030-01-05").getTime();
const now = new Date("2029-12-01").getTime();

test("stock includes a live extension checkout and automatically releases expired or cancelled holds", () => {
  const metadata = {
    kind: "rental_extension",
    status: "checkout",
    requestedEndMs,
    expiresMs: now + 1000,
  };
  assert.equal(
    getReservationAvailabilityEnd({ endDate, activity: [{ metadata }] }, now).getTime(),
    requestedEndMs,
  );
  for (const value of [
    null,
    { ...metadata, expiresMs: now },
    { ...metadata, status: "cancelled" },
    { ...metadata, status: "refunded" },
    { ...metadata, kind: "return_date_request" },
  ])
    assert.equal(
      getReservationAvailabilityEnd({ endDate, activity: [{ metadata: value }] }, now).getTime(),
      endDate.getTime(),
    );
});

test("stock overlap SQL includes held end dates and turnover buffers", () => {
  const query = new MySqlDialect().sqlToQuery(
    buildReservationOverlapPredicate({
      start: endDate,
      end: new Date(requestedEndMs),
      turnoverBufferMinutes: 30,
    }),
  );
  assert.match(query.sql, /extension_hold.reservation_id = `reservations`.`id`/);
  assert.match(query.sql, /expiresMs/);
  assert.match(query.sql, /GREATEST/);
  assert.ok(query.params.some((p) => typeof p === "string" && p.includes("00:30:00")));
});
