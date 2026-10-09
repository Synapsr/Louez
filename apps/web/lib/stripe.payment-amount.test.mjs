import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const { validateStripePaymentAmount } = createRequire(import.meta.url)("@louez/utils");
const source = readFileSync(new URL("./stripe.ts", import.meta.url), "utf8");
const fixture = (name, nextName) => {
  const compiled = stripTypeScriptTypes(
    source
      .slice(
        source.indexOf(`export async function ${name}`),
        source.indexOf(`export async function ${nextName}`),
      )
      .replace("export ", ""),
  );
  const calls = [];
  const fn = runInNewContext(`${compiled}; ${name}`, {
    validateStripePaymentAmount,
    fromStripeCents: (amount, currency) => (currency === "JPY" ? amount : amount / 100),
    stripe: {
      checkout: {
        sessions: {
          create: async (params) => {
            calls.push(params);
            return {
              id: "session",
              url: "https://stripe.example.test/pay",
              expires_at: 1791273600,
            };
          },
        },
      },
    },
    buildReservationPaymentReference: () => ({
      metadata: {},
      clientReferenceId: "booking",
      description: "Test",
    }),
    Date,
  });
  return { fn, calls };
};

for (const amount of [9, 10, 49]) {
  test(`direct checkout API rejects ${amount} EUR cents before calling Stripe`, async () => {
    const f = fixture("createCheckoutSession", "getCheckoutSession");
    await assert.rejects(
      f.fn({ currency: "EUR", lineItems: [{ unitAmount: amount, quantity: 1 }] }),
      /errors.paymentAmountTooSmall/,
    );
    assert.equal(f.calls.length, 0);
  });
}

test("a direct payment request cannot bypass the minimum; the exact minimum works", async () => {
  const f = fixture("createPaymentRequestSession", "createRefund");
  await assert.rejects(f.fn({ currency: "EUR", amount: 10 }), /errors.paymentAmountTooSmall/);
  assert.equal(f.calls.length, 0);
  const result = await f.fn({
    currency: "EUR",
    amount: 50,
    successUrl: "https://example.test/success",
    paymentRequestId: "request",
    feeMetadata: {},
  });
  assert.equal(result.sessionId, "session");
  assert.equal(f.calls.length, 1);
});

test("a Stripe session is expired when recording its payment fails", async () => {
  const paymentSource = readFileSync(
    new URL("./reservations/start-checkout-payment.ts", import.meta.url),
    "utf8",
  );
  const compiled = stripTypeScriptTypes(
    paymentSource
      .slice(paymentSource.indexOf("export const startCheckoutPayment"))
      .replace("export ", ""),
  );
  const { buildStripeLineItems, getCheckoutChargeAmount } = createRequire(import.meta.url)(
    "./reservations/build-stripe-line-items.ts",
  );
  const expired = [];
  const start = runInNewContext(`${compiled}; startCheckoutPayment`, {
    buildStripeLineItems,
    getCheckoutChargeAmount,
    getStorefrontUrl: () => "https://shop.example.test",
    getStoreBilling: async () => ({}),
    planStripeFees: async () => ({ applicationFeeCents: 0 }),
    buildFeeMetadata: () => ({}),
    toStripeCents: (amount) => Math.round(amount * 100),
    createCheckoutSession: async () => ({
      url: "https://stripe.example.test/pay",
      sessionId: "created-session",
    }),
    getStripe: () => ({ checkout: { sessions: { expire: async (id) => expired.push(id) } } }),
    db: {
      transaction: async () => {
        throw new Error("database failure");
      },
    },
    INSURANCE_TAX_LINE_ID: "insurance",
    DELIVERY_TAX_LINE_ID: "delivery",
    getItemTaxLineId: (index) => index.toString(),
    log: { error() {} },
    Date,
  });
  const result = await start({
    store: { id: "store", slug: "shop", stripeAccountId: "account", settings: { currency: "EUR" } },
    reservation: { id: "booking", number: "TEST" },
    lines: [{ productName: "Test", quantity: 1, subtotal: 1 }],
    totals: {
      total: 1,
      deposit: 0,
      deliveryFee: 0,
      discount: 0,
      displayMode: "inclusive",
      taxByLineId: new Map(),
    },
    insuranceAmount: 0,
  });
  assert.equal(result, null);
  assert.deepEqual(expired, ["created-session"]);
});
