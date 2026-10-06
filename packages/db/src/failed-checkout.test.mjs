import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./failed-checkout.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(
  source
    .slice(source.indexOf("export const cancelFailedCheckoutReservation"))
    .replace("export ", ""),
);

const fixture = ({ status = "pending", source = "online", paid = false, amount = "0.10" } = {}) => {
  const changes = [];
  const conditions = [];
  const tx = {
    select: () => ({
      from: (_table) => ({
        where: (condition) => {
          conditions.push(condition);
          return {
            for: async () => [{ id: "booking", status, source, totalAmount: amount }],
            limit: async () => (paid ? [{ id: "payment" }] : []),
          };
        },
      }),
    }),
    update: () => ({ set: (value) => ({ where: async () => changes.push(value) }) }),
    insert: () => ({ values: async (value) => changes.push(value) }),
  };
  const cancel = runInNewContext(`${compiled}; cancelFailedCheckoutReservation`, {
    db: { transaction: (callback) => callback(tx) },
    reservations: { id: "reservation-id", storeId: "store-id" },
    payments: { reservationId: "payment-reservation-id" },
    reservationCalendarEvents: { reservationId: "calendar-reservation-id" },
    reservationActivity: {},
    eq: (key, value) => ({ key, value }),
    and: (...args) => args,
    nanoid: () => "activity",
    Date,
  });
  return {
    changes,
    conditions,
    cancel: () =>
      cancel({
        storeId: "store",
        reservationId: "booking",
        reason: "amount_too_small",
        expectedAmount: "0.10",
        minimumAmount: 0.5,
        currency: "EUR",
      }),
  };
};

test("cleanup scopes by store and records cancellation plus payment failure together", async () => {
  const f = fixture();
  assert.equal(await f.cancel(), true);
  assert.equal(f.conditions[0][1].value, "store");
  assert.equal(f.changes[0].status, "cancelled");
  assert.equal(f.changes[1][0].activityType, "payment_failed");
  assert.equal(f.changes[1][1].activityType, "cancelled");
  assert.equal(f.changes[1][1].metadata.minimumAmount, 0.5);
});

for (const options of [
  { paid: true },
  { status: "confirmed" },
  { status: "cancelled" },
  { source: "phone" },
  { amount: "100.00" },
]) {
  test(`cleanup preserves payment, decisions, sources and changed amounts: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    assert.equal(await f.cancel(), false);
    assert.equal(f.changes.length, 0);
  });
}
