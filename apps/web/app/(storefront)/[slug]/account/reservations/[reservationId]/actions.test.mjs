import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { z } from "zod";

const { renterGateRefusalParams } = createRequire(import.meta.url)(
  "../../../../../../lib/billing/reservation-gate-error.ts",
);

const source = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const start = source.indexOf("const describeError");
assert.ok(start > 0, "actions.ts changed shape: update this test");
const compiled = stripTypeScriptTypes(
  source.slice(start).replaceAll("export async function", "async function"),
);

const reservationId = "booking_0123456789abc";
const table = (name) => new Proxy({}, { get: (_, column) => `${name}.${String(column)}` });
const reservations = table("reservations");

/** What a refused change must not do. */
const sideEffectsOf = (calls) =>
  calls.filter((call) => ["session", "effects", "analytics", "notify"].includes(call));

/** The three actions with fake dependencies. `calls` records the order of side effects. */
class StoreNotAcceptingReservationsError extends Error {
  storeId = "store";
  reason = "payment_method_required";
}

const setup = ({ refuse = false, sessionThrows = false, gateClosed = false } = {}) => {
  const calls = [];
  const changes = [];
  const effectRuns = [];
  const effects = [{ type: "legacy_fee.record", storeId: "store", reservationId }];
  const customer = {
    id: "customer",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    phone: null,
  };
  const store = {
    id: "store",
    slug: "shop",
    name: "Shop",
    email: "shop@example.test",
    phone: "+33 6 12 34 56 78",
    settings: { currency: "EUR" },
    notificationSettings: {},
    cgv: "",
  };
  const reservation = {
    id: reservationId,
    number: "R-1",
    status: "quote",
    startDate: new Date(0),
    endDate: new Date(0),
    totalAmount: "10.00",
    subtotalAmount: "10.00",
    depositAmount: "0.00",
    tulipContractId: "tulip-contract",
    customer,
    items: [],
  };
  const step = (name) => async () => {
    calls.push(name);
  };
  const tx = {
    // cancelReservationRequest locks the reservation, then its payments.
    select: () => ({
      from: (from) => ({
        where: () => ({ for: async () => (from === reservations ? [{ status: "pending" }] : []) }),
      }),
    }),
  };

  const actions = runInNewContext(
    `${compiled}; ({ acceptQuote, declineQuote, cancelReservationRequest })`,
    {
      z,
      and: (...parts) => parts,
      eq: (column, value) => [column, value],
      reservations,
      payments: table("payments"),
      stores: table("stores"),
      verificationCodes: table("verificationCodes"),
      db: {
        query: {
          stores: { findFirst: async () => store },
          reservations: { findFirst: async () => reservation },
        },
        transaction: async (run) => run(tx),
      },
      getCustomerSession: async () => ({ customerId: "customer", customer }),
      changeReservationStatus: async (_tx, input) => {
        calls.push("change");
        changes.push(input);
        if (refuse) return { changed: false, from: "confirmed", reason: "unexpected_status" };
        if (gateClosed) throw new StoreNotAcceptingReservationsError("closed");
        await input.beforeWrite?.();
        return { changed: true, from: "quote", to: input.to, effects };
      },
      checkExistingReservationInventory: step("inventory"),
      validateReservationContract: step("contract"),
      ConsumableStockError: class extends Error {},
      ReservationInventoryError: class extends Error {},
      isStoreNotAcceptingReservationsError: (error) =>
        error instanceof StoreNotAcceptingReservationsError,
      logReservationGateRefusal: (refusal, surface) => {
        calls.push(`gate:${surface}:${refusal.reason}`);
      },
      STORE_NOT_ACCEPTING_RESERVATIONS_ERROR: "errors.storeNotAcceptingReservations",
      renterGateRefusalParams,
      runReservationEffects: async (list) => {
        calls.push("effects");
        effectRuns.push(list);
      },
      getEffectiveReservationMode: () => "payment",
      createReservationPaymentSessionForCustomer: async () => {
        calls.push("session");
        if (sessionThrows) throw new Error("Stripe unavailable");
        return { success: true, paymentUrl: "https://pay.example.test" };
      },
      captureProductServerEvent: step("analytics"),
      toAnalyticsAmountCents: () => 0,
      productAnalyticsEvents: { quoteAccepted: "accepted", quoteDeclined: "declined" },
      cancelTulipContractForReservation: step("tulip"),
      dispatchNotification: step("notify"),
      dispatchCustomerNotification: step("customer email"),
      sendRequestCancelledEmail: step("store email"),
      createReservationInstantAccessUrl: async () => "https://shop.example.test/contract",
      getStorefrontUrl: (slug, path) => `https://${slug}.example.test${path}`,
      revalidatePath: () => {},
      log: { error() {} },
    },
  );
  const order = (...names) => calls.filter((call) => names.includes(call));
  return { actions, calls, changes, effectRuns, effects, order };
};

test("acceptQuote opens the payment session before it records the fee", async () => {
  const { actions, changes, effectRuns, effects, order } = setup();
  const result = await actions.acceptQuote("shop", reservationId);

  assert.equal(result.success, true);
  assert.equal(result.paymentUrl, "https://pay.example.test");
  assert.equal(changes[0].to, "confirmed");
  assert.equal(changes[0].expectedFrom, "quote");
  assert.equal(changes[0].storeId, "store");
  // The session takes the fee at source only while no fee row exists.
  assert.deepEqual(order("inventory", "session", "effects", "notify"), [
    "inventory",
    "session",
    "effects",
    "notify",
  ]);
  assert.equal(effectRuns.length, 1);
  assert.equal(effectRuns[0], effects);
});

test("acceptQuote still records the fee when the payment session throws", async () => {
  const { actions, effectRuns, calls } = setup({ sessionThrows: true });
  await assert.rejects(actions.acceptQuote("shop", reservationId), /Stripe unavailable/);
  assert.equal(effectRuns.length, 1);
  assert.equal(calls.includes("notify"), false);
});

test("acceptQuote refuses a quote that changed meanwhile", async () => {
  const { actions, calls } = setup({ refuse: true });
  const result = await actions.acceptQuote("shop", reservationId);

  assert.equal(result.error, "invalidStatus");
  assert.deepEqual(sideEffectsOf(calls), []);
});

test("acceptQuote answers a closed card gate with the generic key and the store's contact, and does nothing else", async () => {
  const { actions, calls } = setup({ gateClosed: true });
  const result = await actions.acceptQuote("shop", reservationId);

  assert.equal(result.error, "errors.storeNotAcceptingReservations");
  assert.deepEqual(
    { ...result.errorParams },
    { hasContact: "yes", contact: "+33 6 12 34 56 78 · shop@example.test" },
  );
  assert.equal(calls.includes("gate:quote_acceptance:payment_method_required"), true);
  assert.equal(calls.includes("inventory"), false);
  assert.deepEqual(sideEffectsOf(calls), []);
});

test("declineQuote refuses a quote the store confirmed meanwhile", async () => {
  const { actions, changes, calls } = setup({ refuse: true });
  const result = await actions.declineQuote("shop", reservationId);

  assert.equal(result.error, "invalidStatus");
  assert.equal(changes[0].to, "declined");
  assert.equal(changes[0].expectedFrom, "quote");
  assert.equal(changes[0].storeId, "store");
  assert.deepEqual(sideEffectsOf(calls), []);
});

test("declineQuote voids the fee before it tells the store", async () => {
  const { actions, effectRuns, effects, order } = setup();
  const result = await actions.declineQuote("shop", reservationId);

  assert.equal(result.success, true);
  assert.deepEqual(order("effects", "analytics", "notify"), ["effects", "analytics", "notify"]);
  assert.equal(effectRuns[0], effects);
});

test("cancelReservationRequest voids the fee before the insurance and the emails", async () => {
  const { actions, changes, effectRuns, effects, order } = setup();
  const result = await actions.cancelReservationRequest("shop", reservationId);

  assert.equal(result.success, true);
  assert.equal(changes[0].to, "cancelled");
  assert.equal(changes[0].expectedFrom, "pending");
  assert.deepEqual(order("change", "effects", "tulip", "notify", "store email"), [
    "change",
    "effects",
    "tulip",
    "notify",
    "store email",
  ]);
  assert.equal(effectRuns[0], effects);
});
