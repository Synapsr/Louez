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

const VOID_EFFECT = { type: "legacy_fee.void", storeId: "store", reservationId: "booking" };

const fixture = ({ status = "pending", source = "online", paid = false, amount = "0.10" } = {}) => {
  const changes = [];
  const conditions = [];
  const statusChanges = [];
  /** What happened, in order: the commit, then the effects. */
  const events = [];
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
    db: {
      transaction: async (callback) => {
        const result = await callback(tx);
        events.push("commit");
        return result;
      },
    },
    reservations: { id: "reservation-id", storeId: "store-id" },
    payments: { reservationId: "payment-reservation-id" },
    reservationCalendarEvents: { reservationId: "calendar-reservation-id" },
    reservationActivity: {},
    eq: (key, value) => ({ key, value }),
    and: (...args) => args,
    nanoid: () => "activity",
    toWholeSeconds: (date) => date,
    changeReservationStatus: async (_tx, input) => {
      statusChanges.push(input);
      return { changed: true, from: "pending", to: input.to, effects: [VOID_EFFECT] };
    },
    Date,
  });
  return {
    changes,
    conditions,
    statusChanges,
    events,
    cancel: () =>
      cancel(
        {
          storeId: "store",
          reservationId: "booking",
          reason: "amount_too_small",
          expectedAmount: "0.10",
          minimumAmount: 0.5,
          currency: "EUR",
        },
        async (effects) => {
          events.push(effects);
        },
      ),
  };
};

test("cleanup scopes by store and records the payment failure, then the cancellation", async () => {
  const f = fixture();
  assert.equal(await f.cancel(), true);
  assert.equal(f.conditions[0][1].value, "store");
  assert.equal(f.changes[0].activityType, "payment_failed");
  assert.equal(f.changes[0].metadata.minimumAmount, 0.5);
  assert.equal(f.statusChanges.length, 1);
  const [change] = f.statusChanges;
  assert.equal(change.reservationId, "booking");
  assert.equal(change.storeId, "store");
  assert.equal(change.to, "cancelled");
  assert.equal(change.actor, "system");
  assert.equal(change.expectedFrom, "pending");
  assert.equal(change.activity.metadata.source, "checkout_payment_failed");
  assert.equal(change.activity.metadata.minimumAmount, 0.5);
  // The calendar requeue follows the status change.
  assert.equal(f.changes[1].syncStatus, "pending");
});

test("cleanup runs the fee effects after commit", async () => {
  const f = fixture();
  await f.cancel();
  assert.deepEqual(f.events, ["commit", [VOID_EFFECT]]);
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
    assert.equal(f.statusChanges.length, 0);
    assert.deepEqual(f.events, ["commit"]);
  });
}
