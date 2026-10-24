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
      runReservationEffects: async () => {},
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
  const runReservationEffects = async () => {};
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
    cancelFailedCheckoutReservation: async (input, runner) => {
      cancellations.push({ input, runner });
      return true;
    },
    runReservationEffects,
    failReservation: (error, params) => ({ ok: false, error, params }),
    describeError: String,
    log: { error() {} },
  });
  return {
    writes,
    cancellations,
    notifications,
    runReservationEffects,
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
  assert.equal(failed.cancellations[0].input.storeId, "store");
  // The cancellation runs its fee effects after commit.
  assert.equal(failed.cancellations[0].runner, failed.runReservationEffects);
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

const writeSource = stripTypeScriptTypes(
  source.slice(
    source.indexOf("const writeReservation ="),
    source.indexOf("/**\n * Internal reservation pipeline"),
  ),
);

const writeFixture = ({ supersede }) => {
  const events = [];
  const tx = { insert: () => ({ values: async () => {} }) };
  const write = runInNewContext(`${writeSource}; writeReservation`, {
    db: {
      transaction: async (work) => {
        const result = await work(tx);
        events.push("commit");
        return result;
      },
    },
    getBlockingReservationStatuses: () => [],
    lockReservationProducts: async () => new Map(),
    lockResumableCheckout: async (_tx, _storeId, resumable) => resumable,
    reserveInventory: async () => ({
      ok: true,
      inventory: { resolvedCombinationByLineKey: new Map() },
    }),
    upsertCustomer: async () => ({ id: "customer", email: "guest@example.test" }),
    buildReservationValues: () => ({ status: "pending" }),
    buildReservationItemValues: () => [],
    isSamePendingCheckout: () => false,
    nanoid: () => "replacement",
    generateUniqueReservationNumber: async () => "TEST-2",
    insertReservation: async () => ({ effects: [] }),
    reservationItems: {},
    reservationActivity: {},
    toWholeSeconds: (date) => date,
    supersedePendingCheckout: async () => {
      events.push("supersede");
      return supersede();
    },
    runReservationEffects: async (effects) => {
      events.push(["run", [...effects]]);
    },
    expireCheckoutSessions: (_account, sessionIds) => {
      events.push(["expire", [...sessionIds]]);
    },
  });
  return {
    events,
    submit: () =>
      write(
        {
          source: "online",
          items: [],
          customer: { email: "guest@example.test", firstName: "Test", lastName: "Guest" },
        },
        {
          store: { id: "store", settings: null, stripeAccountId: "acct" },
          promo: null,
          window: {},
          insurance: { appliedOptIn: false, amount: 0 },
          advisorConversation: null,
        },
        { id: "earlier", number: "TEST-1" },
      ),
  };
};

const VOID = { type: "legacy_fee.void", storeId: "store", reservationId: "earlier" };

test("a resubmitted cart runs the superseded checkout's void after commit", async () => {
  const fixture = writeFixture({
    supersede: () => ({ sessionIds: ["cs_earlier"], effects: [VOID] }),
  });

  assert.equal((await fixture.submit()).ok, true);
  assert.deepEqual(fixture.events, [
    "supersede",
    "commit",
    ["run", [VOID]],
    ["expire", ["cs_earlier"]],
  ]);
});

test("a resubmitted cart that rolls back runs no effect", async () => {
  const fixture = writeFixture({
    supersede: () => {
      throw new Error("Could not supersede checkout earlier: unexpected_status");
    },
  });

  await assert.rejects(fixture.submit(), /unexpected_status/);
  assert.deepEqual(fixture.events, ["supersede"]);
});
