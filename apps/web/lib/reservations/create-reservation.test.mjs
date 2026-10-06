import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
const { validateStripePaymentAmount } = createRequire(import.meta.url)("@louez/utils");
const { getCheckoutChargeAmount } = createRequire(import.meta.url)("./build-stripe-line-items.ts");

const source = readFileSync(new URL("./create-reservation.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(
  source.slice(source.indexOf("export const createReservation =")).replace("export ", ""),
);

for (const mode of ["request", "payment", "payment-unavailable"]) {
  test(`${mode} checkout cannot log into the account of its unverified email`, async () => {
    let tokensIssued = 0;
    const prepared = {
      store: { id: "store", slug: "shop" },
      totals: { total: 1 },
      insurance: { amount: 0, appliedOptIn: false },
      promo: null,
      delivery: {},
      cart: { lines: [] },
      window: { start: new Date(), end: new Date() },
      customerPhone: null,
    };
    const create = runInNewContext(`${compiled}; createReservation`, {
      checkMarketplaceCapability: async () => null,
      prepareReservation: async () => ({ ok: true, prepared }),
      writeReservation: async () => ({
        ok: true,
        replay: false,
        reused: false,
        reservationId: "booking",
        reservationNumber: "TEST-1",
        customerId: "existing-customer",
        customerEmail: "victim@example.test",
      }),
      getEffectiveReservationMode: () => (mode === "request" ? "request" : "payment"),
      getCheckoutChargeAmount,
      validateStripePaymentAmount,
      cancelFailedCheckoutReservation: async () => true,
      runPostCreationEffects: async () => {},
      notifyRequestReceived: async () => {},
      startCheckoutPayment: async () =>
        mode === "payment" ? "https://checkout.example.test/session" : null,
      createReservationInstantAccessUrl: async () => {
        tokensIssued++;
        return "https://shop.example.test/r/booking?token=unsafe";
      },
      describeError: String,
      log: { error() {} },
      failReservation: (error) => ({ ok: false, error }),
    });
    const result = await create({
      source: "online",
      customer: { email: "victim@example.test", firstName: "Guest", lastName: "Checkout" },
      items: [{ quantity: 1 }],
    });
    assert.equal(result.ok, mode !== "payment-unavailable");
    if (!result.ok) {
      assert.equal(result.error, "errors.checkoutPaymentFailed");
      assert.equal(tokensIssued, 0);
      return;
    }
    assert.equal(result.customerId, "existing-customer");
    assert.equal(result.instantAccessUrl, null);
    assert.equal(tokensIssued, 0);
    assert.equal(
      result.paymentUrl,
      mode === "payment" ? "https://checkout.example.test/session" : null,
    );
  });
}

const checkoutFixture = ({
  total = 0.1,
  source = "online",
  mode = "payment",
  paymentUrl = "https://stripe.example.test/pay",
} = {}) => {
  const writes = [];
  const cancellations = [];
  const notifications = [];
  const prepared = {
    store: {
      id: "store",
      slug: "shop",
      settings: { currency: "EUR", onlinePaymentDepositPercentage: 100 },
    },
    totals: { total },
    insurance: { amount: 0, appliedOptIn: false },
    promo: null,
    delivery: {},
    cart: { lines: [] },
    window: { start: new Date(), end: new Date() },
    customerPhone: null,
  };
  const create = runInNewContext(`${compiled}; createReservation`, {
    checkMarketplaceCapability: async () => null,
    prepareReservation: async () => ({ ok: true, prepared }),
    getEffectiveReservationMode: () => mode,
    getCheckoutChargeAmount,
    validateStripePaymentAmount,
    writeReservation: async () => {
      writes.push(true);
      return {
        ok: true,
        replay: false,
        reused: false,
        reservationId: "booking",
        reservationNumber: "TEST",
        customerId: "customer",
      };
    },
    runPostCreationEffects: async () => {},
    notifyRequestReceived: async () => {
      notifications.push(true);
    },
    startCheckoutPayment: async () => paymentUrl,
    cancelFailedCheckoutReservation: async (input) => {
      cancellations.push(input);
      return true;
    },
    failReservation: (error, params) => ({ ok: false, error, params }),
    describeError: String,
    log: { error() {} },
  });
  return {
    writes,
    cancellations,
    notifications,
    submit: () =>
      create({
        source,
        items: [{ quantity: 1 }],
        customer: { email: "guest@example.test", firstName: "Test", lastName: "Guest" },
      }),
  };
};

for (const source of ["online", "marketplace"]) {
  test(`${source} rejects a server-priced 0.10 EUR total before writing any reservation`, async () => {
    const fixture = checkoutFixture({ source });
    const result = await fixture.submit();
    assert.equal(result.ok, false);
    assert.equal(result.error, "errors.paymentAmountTooSmall");
    assert.equal(result.params.minimumAmount, 0.5);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.notifications.length, 0);
  });
}

test("minimum permits checkout; session failure cancels without a request notification", async () => {
  const valid = checkoutFixture({ total: 0.5 });
  assert.equal((await valid.submit()).ok, true);
  const failed = checkoutFixture({ total: 1, paymentUrl: null });
  assert.equal((await failed.submit()).error, "errors.checkoutPaymentFailed");
  assert.equal(failed.cancellations.length, 1);
  assert.equal(failed.cancellations[0].storeId, "store");
  assert.equal(failed.notifications.length, 0);
});

for (const options of [{ mode: "request" }, { source: "phone" }]) {
  test(`small requests do not require payment: ${JSON.stringify(options)}`, async () => {
    const fixture = checkoutFixture(options);
    const result = await fixture.submit();
    assert.equal(result.ok, true);
    assert.equal(result.paymentUrl, null);
    assert.equal(fixture.notifications.length, 1);
  });
}
