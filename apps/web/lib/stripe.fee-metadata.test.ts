import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";

import type Stripe from "stripe";

// Fee metadata v4 (louez-billing fees.md §8) on the sessions lib/stripe.ts creates, read
// back as the webhook and the claim read it. Stripe is stubbed: no network. The modules
// load @louez/db: a closed port keeps any query away from a real database.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.DATABASE_URL = "mysql://louez:louez@127.0.0.1:1/unreachable";

/** Stripe metadata as Stripe returns it: strings. */
const strings = (metadata: Stripe.MetadataParam | undefined | null): Record<string, string> =>
  Object.fromEntries(Object.entries(metadata ?? {}).map(([key, value]) => [key, String(value)]));

/**
 * The v3 keys, the only fee metadata the release before v4 reads. They keep its webhook
 * from billing the marketplace fee again if it completes a session created by this one.
 */
const v3Keys = (metadata: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(metadata).filter(([key]) => key.startsWith("platform")));

describe("fee metadata v4 on Checkout Sessions", () => {
  let stripeModule: typeof import("./stripe");
  let metering: typeof import("./pay-as-you-go/metering");
  let feeMetadata: typeof import("./billing-sync/fee-metadata");
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  const billing = process.env.LOUEZ_BILLING;

  before(async () => {
    stripeModule = await import("./stripe");
    metering = await import("./pay-as-you-go/metering");
    feeMetadata = await import("./billing-sync/fee-metadata");
    Reflect.set(
      stripeModule.getStripe().checkout.sessions,
      "create",
      async (params: Stripe.Checkout.SessionCreateParams) => {
        created.push(params);
        return {
          id: "cs_test",
          url: "https://checkout.stripe.test/pay",
          expires_at: 1_900_000_000,
        };
      },
    );
  });

  afterEach(() => {
    created.length = 0;
    if (billing === undefined) delete process.env.LOUEZ_BILLING;
    else process.env.LOUEZ_BILLING = billing;
  });

  const plan = { applicationFeeCents: 250, reservationFeeCents: 150, marketplaceFeeCents: 100 };

  test("the storefront checkout writes v4 on the session and its PaymentIntent", async () => {
    process.env.LOUEZ_BILLING = "cloud";
    await stripeModule.createCheckoutSession({
      stripeAccountId: "acct_store",
      reservationId: "res_1",
      reservationNumber: "R-1",
      customerEmail: "renter@example.invalid",
      lineItems: [{ name: "Bike", quantity: 1, unitAmount: 12_000 }],
      depositAmount: 5_000,
      currency: "EUR",
      successUrl: "https://shop.example.invalid/checkout/return",
      cancelUrl: "https://shop.example.invalid/checkout/cancelled",
      applicationFeeAmount: plan.applicationFeeCents,
      feeMetadata: metering.buildLegacyFeeMetadata(plan, {
        insuranceShareMinor: 700,
        paymentKind: "rental",
        reservationId: "res_1",
        storeId: "store_1",
      }),
      checkoutFlow: "storefront_checkout",
    });

    const [params] = created;
    const sessionMetadata = strings(params.metadata);
    const intentMetadata = strings(params.payment_intent_data?.metadata);
    const facts = {
      metadataVersion: 4,
      totalMinor: 250,
      reservationMinor: 150,
      marketplaceMinor: 100,
      baseMinor: 0,
      insuranceShareMinor: 700,
      policyScope: "legacy",
      policyVersion: 0,
      paymentKind: "rental",
    };
    assert.deepEqual(feeMetadata.readFeeMetadata(sessionMetadata), facts);
    assert.deepEqual(feeMetadata.readFeeMetadata(intentMetadata), facts);
    // The legacy fee recording in the webhook reads the same parts.
    assert.deepEqual(metering.parseFeeMetadata(intentMetadata), {
      reservationFeeCents: 150,
      marketplaceFeeCents: 100,
      hasBreakdown: true,
    });
    // The release before v4 reads only the v3 keys of the PaymentIntent.
    assert.deepEqual(v3Keys(intentMetadata), {
      platformFeeVersion: "3",
      platformReservationFeeCents: "150",
      platformMarketplaceFeeCents: "100",
    });
    // The keys other code reads are kept, and the fee taken is unchanged.
    assert.equal(sessionMetadata.reservationId, "res_1");
    assert.equal(sessionMetadata.type, "reservation_payment");
    assert.equal(sessionMetadata.depositAmount, "5000");
    assert.equal(sessionMetadata.checkoutFlow, "storefront_checkout");
    assert.equal(sessionMetadata.storeId, "store_1");
    assert.equal(intentMetadata.reservationId, "res_1");
    assert.equal(params.payment_intent_data?.application_fee_amount, 250);
  });

  test("a payment request writes v4 with no fee, and keeps its request id", async () => {
    process.env.LOUEZ_BILLING = "cloud";
    await stripeModule.createPaymentRequestSession({
      stripeAccountId: "acct_store",
      reservationId: "res_2",
      reservationNumber: "R-2",
      customerEmail: "renter@example.invalid",
      amount: 4_000,
      description: "Damage",
      currency: "EUR",
      successUrl: "https://shop.example.invalid/account",
      cancelUrl: "https://shop.example.invalid/pay/res_2",
      paymentRequestId: "req_1",
      feeMetadata: metering.buildLegacyFeeMetadata(null, {
        insuranceShareMinor: 0,
        paymentKind: "custom_request",
        reservationId: "res_2",
        storeId: "store_1",
      }),
    });

    const [params] = created;
    for (const metadata of [
      strings(params.metadata),
      strings(params.payment_intent_data?.metadata),
    ]) {
      assert.deepEqual(feeMetadata.readFeeMetadata(metadata), {
        metadataVersion: 4,
        totalMinor: 0,
        reservationMinor: 0,
        marketplaceMinor: 0,
        baseMinor: 0,
        insuranceShareMinor: 0,
        policyScope: "legacy",
        policyVersion: 0,
        paymentKind: "custom_request",
      });
      assert.equal(metadata.paymentRequestId, "req_1");
      assert.equal(metadata.type, "payment_request");
      assert.deepEqual(v3Keys(metadata), {});
    }
    assert.equal(params.payment_intent_data?.application_fee_amount, undefined);
  });

  test("the v3 keys are written as before v4: only for a fee, and each part above 0", () => {
    process.env.LOUEZ_BILLING = "cloud";
    const payment = {
      insuranceShareMinor: 0,
      paymentKind: "rental",
      reservationId: "res_5",
      storeId: "store_1",
    } as const;
    const marketplaceOnly = {
      applicationFeeCents: 100,
      reservationFeeCents: 0,
      marketplaceFeeCents: 100,
    };
    assert.deepEqual(v3Keys(metering.buildLegacyFeeMetadata(marketplaceOnly, payment)), {
      platformFeeVersion: "3",
      platformMarketplaceFeeCents: "100",
    });
    const noFee = { applicationFeeCents: 0, reservationFeeCents: 0, marketplaceFeeCents: 0 };
    assert.deepEqual(v3Keys(metering.buildLegacyFeeMetadata(noFee, payment)), {});
    // Both versions on one PaymentIntent: v4 is read first.
    assert.equal(
      feeMetadata.readFeeMetadata(metering.buildLegacyFeeMetadata(marketplaceOnly, payment))
        ?.metadataVersion,
      4,
    );
  });

  test("with platform billing off, sessions carry no fee metadata", async () => {
    process.env.LOUEZ_BILLING = "off";
    assert.deepEqual(
      metering.buildLegacyFeeMetadata(plan, {
        insuranceShareMinor: 0,
        paymentKind: "rental",
        reservationId: "res_3",
        storeId: "store_1",
      }),
      {},
    );
  });

  test("the webhook still reads the v3 keys of sessions created before v4", () => {
    assert.deepEqual(
      metering.parseFeeMetadata({
        platformFeeVersion: "3",
        platformReservationFeeCents: "150",
        platformMarketplaceFeeCents: "100",
      }),
      { reservationFeeCents: 150, marketplaceFeeCents: 100, hasBreakdown: true },
    );
    assert.deepEqual(metering.parseFeeMetadata({ reservationId: "res_4" }), {
      reservationFeeCents: 0,
      marketplaceFeeCents: 0,
      hasBreakdown: false,
    });
  });
});
