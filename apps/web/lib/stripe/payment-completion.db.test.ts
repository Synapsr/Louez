import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { readFeeMetadata } from "@/lib/billing-sync/fee-metadata";

// The checkout claim on a migrated database: the payment facts it writes (billing
// contract Q3, Q5, Q7, Q36), the payment request it completes, and the reservation mark.

const STORE = "store_claim";
const CLAIMED_AT = new Date("2026-12-01T00:00:05Z");
/** The charge was made before midnight; its month is November. */
const CHARGED_AT = new Date("2026-11-30T23:59:58Z");

const v4Facts = () =>
  readFeeMetadata({
    louezFeeV: "4",
    louezFeeTotalMinor: "250",
    louezFeeReservationMinor: "150",
    louezFeeMarketplaceMinor: "100",
    louezFeeBaseMinor: "0",
    louezInsuranceShareMinor: "700",
    louezPolicyScope: "legacy",
    louezPolicyVersion: "0",
    louezPaymentKind: "rental",
    reservationId: "ignored",
    storeId: STORE,
  });

describe("checkout payment claim (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let completion: typeof import("./payment-completion");
  let counter = 0;
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("payment_claim");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    completion = await import("./payment-completion");
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: "owner", name: "Claim", slug: "payment-claim" });
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
  });
  afterEach(() => {
    for (const [name, value] of [
      ["LOUEZ_BILLING", env.billing],
      ["BILLING_SERVICE_URL", env.url],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function createReservation() {
    const id = `res_claim_${++counter}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status: "pending",
      startDate: new Date("2026-12-10T09:00:00Z"),
      endDate: new Date("2026-12-12T09:00:00Z"),
      subtotalAmount: "120.00",
      depositAmount: "0.00",
      totalAmount: "120.00",
      tulipInsuranceAmount: "14.00",
      currency: "EUR",
    });
    return id;
  }

  const claim = (
    reservationId: string,
    overrides: Partial<Parameters<typeof completion.claimCompletedCheckoutPayment>[0]> = {},
  ) =>
    completion.claimCompletedCheckoutPayment({
      reservationId,
      amount: 60,
      currency: "EUR",
      stripeCheckoutSessionId: `cs_${reservationId}`,
      stripePaymentIntentId: `pi_${reservationId}`,
      stripeChargeId: `ch_${reservationId}`,
      stripePaymentMethodId: "pm_card",
      stripeAccountId: "acct_store",
      claimedAt: CLAIMED_AT,
      paidAt: CHARGED_AT,
      grossMinor: 6000,
      insuranceShareMinor: 700,
      origin: "checkout",
      paymentRequestId: null,
      feeFacts: v4Facts(),
      ...overrides,
    });

  async function readPayment(reservationId: string) {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    return row;
  }

  async function readMark(reservationId: string) {
    const [row] = await louezDb.db
      .select({
        storeId: louezDb.billingSyncQueue.storeId,
        version: louezDb.billingSyncQueue.version,
        status: louezDb.billingSyncQueue.status,
      })
      .from(louezDb.billingSyncQueue)
      .where(eq(louezDb.billingSyncQueue.aggregateId, reservationId));
    return row;
  }

  test("the claim of a pending session row writes every fact and marks the reservation", async () => {
    const reservationId = await createReservation();
    await louezDb.db.insert(louezDb.payments).values({
      id: `pay_${reservationId}`,
      reservationId,
      amount: "60.00",
      type: "rental",
      method: "stripe",
      status: "pending",
      stripeCheckoutSessionId: `cs_${reservationId}`,
      origin: "customer_session",
      currency: "EUR",
      createdAt: new Date("2026-11-30T23:50:00Z"),
    });

    assert.deepEqual(await claim(reservationId), {
      paymentId: `pay_${reservationId}`,
      claimed: true,
    });

    const payment = await readPayment(reservationId);
    assert.deepEqual(
      {
        status: payment.status,
        grossMinor: payment.grossMinor,
        insuranceShareMinor: payment.insuranceShareMinor,
        // The row keeps the origin it got when the session was created.
        origin: payment.origin,
        paymentRequestId: payment.paymentRequestId,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        stripeChargeId: payment.stripeChargeId,
        stripeAccountId: payment.stripeAccountId,
        paidAt: payment.paidAt,
        appFeeTotalMinor: payment.appFeeTotalMinor,
        appFeeReservationMinor: payment.appFeeReservationMinor,
        appFeeMarketplaceMinor: payment.appFeeMarketplaceMinor,
        appFeeBaseMinor: payment.appFeeBaseMinor,
        appFeePolicyScope: payment.appFeePolicyScope,
        appFeePolicyVersion: payment.appFeePolicyVersion,
        appFeeMetadataVersion: payment.appFeeMetadataVersion,
      },
      {
        status: "completed",
        grossMinor: 6000,
        insuranceShareMinor: 700,
        origin: "customer_session",
        paymentRequestId: null,
        stripePaymentIntentId: `pi_${reservationId}`,
        stripeChargeId: `ch_${reservationId}`,
        stripeAccountId: "acct_store",
        paidAt: CHARGED_AT,
        appFeeTotalMinor: 250,
        appFeeReservationMinor: 150,
        appFeeMarketplaceMinor: 100,
        appFeeBaseMinor: 0,
        appFeePolicyScope: "legacy",
        appFeePolicyVersion: 0,
        appFeeMetadataVersion: 4,
      },
    );
    assert.deepEqual(await readMark(reservationId), {
      storeId: STORE,
      version: 1,
      status: "pending",
    });

    // The other completion path finds it claimed and writes nothing.
    assert.deepEqual(await claim(reservationId, { grossMinor: 1 }), {
      paymentId: `pay_${reservationId}`,
      claimed: false,
    });
    assert.equal((await readPayment(reservationId)).grossMinor, 6000);
    assert.equal((await readMark(reservationId)).version, 1);
  });

  test("a payment request is completed with its payment, in the claim's transaction", async () => {
    const reservationId = await createReservation();
    const requestId = `req_${counter}`;
    await louezDb.db.insert(louezDb.paymentRequests).values({
      id: requestId,
      storeId: STORE,
      reservationId,
      token: `token_${reservationId}`,
      amount: "60.00",
      description: "Balance",
      type: "custom",
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });

    const result = await claim(reservationId, {
      origin: "payment_request",
      paymentRequestId: requestId,
      insuranceShareMinor: 0,
      // A session created before metadata v4 carried no fee keys.
      feeFacts: null,
    });
    assert.equal(result.claimed, true);

    const payment = await readPayment(reservationId);
    assert.deepEqual(
      {
        id: payment.id,
        type: payment.type,
        origin: payment.origin,
        paymentRequestId: payment.paymentRequestId,
        insuranceShareMinor: payment.insuranceShareMinor,
        appFeeTotalMinor: payment.appFeeTotalMinor,
        appFeeMetadataVersion: payment.appFeeMetadataVersion,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
      },
      {
        id: result.paymentId,
        type: "rental",
        origin: "payment_request",
        paymentRequestId: requestId,
        insuranceShareMinor: 0,
        appFeeTotalMinor: null,
        appFeeMetadataVersion: null,
        paidAt: CHARGED_AT,
        createdAt: CLAIMED_AT,
      },
    );
    const [request] = await louezDb.db
      .select({
        status: louezDb.paymentRequests.status,
        completedAt: louezDb.paymentRequests.completedAt,
      })
      .from(louezDb.paymentRequests)
      .where(eq(louezDb.paymentRequests.id, requestId));
    assert.deepEqual(request, { status: "completed", completedAt: CLAIMED_AT });
    assert.equal((await readMark(reservationId)).version, 1);

    // A replay of the webhook keeps the first completion time.
    await claim(reservationId, {
      origin: "payment_request",
      paymentRequestId: requestId,
      claimedAt: new Date("2026-12-02T00:00:00Z"),
    });
    const [replayed] = await louezDb.db
      .select({ completedAt: louezDb.paymentRequests.completedAt })
      .from(louezDb.paymentRequests)
      .where(eq(louezDb.paymentRequests.id, requestId));
    assert.deepEqual(replayed, { completedAt: CLAIMED_AT });
  });

  test("a v3 session's fee keys fill the legacy fee columns", async () => {
    const reservationId = await createReservation();
    await claim(reservationId, {
      feeFacts: readFeeMetadata({
        platformFeeVersion: "3",
        platformReservationFeeCents: "150",
      }),
    });
    const payment = await readPayment(reservationId);
    assert.deepEqual(
      {
        origin: payment.origin,
        appFeeTotalMinor: payment.appFeeTotalMinor,
        appFeeReservationMinor: payment.appFeeReservationMinor,
        appFeeMarketplaceMinor: payment.appFeeMarketplaceMinor,
        appFeeBaseMinor: payment.appFeeBaseMinor,
        appFeePolicyScope: payment.appFeePolicyScope,
        appFeeMetadataVersion: payment.appFeeMetadataVersion,
      },
      {
        origin: "checkout",
        appFeeTotalMinor: 150,
        appFeeReservationMinor: 150,
        appFeeMarketplaceMinor: 0,
        appFeeBaseMinor: 0,
        appFeePolicyScope: "legacy",
        appFeeMetadataVersion: 3,
      },
    );
  });

  test("without the billing service, the claim writes the facts and no mark", async () => {
    delete process.env.BILLING_SERVICE_URL;
    const reservationId = await createReservation();
    await claim(reservationId);
    assert.equal((await readPayment(reservationId)).grossMinor, 6000);
    assert.equal(await readMark(reservationId), undefined);
  });

  test("the insurance share follows fees.md §4, and only rental money has one", () => {
    const totals = () => ({ insuranceMinor: 1400, totalInclTaxMinor: 12_000 });
    assert.equal(completion.paymentInsuranceShareMinor("rental", 6000, totals), 700);
    assert.equal(completion.paymentInsuranceShareMinor("extension", 6000, totals), 700);
    assert.equal(completion.paymentInsuranceShareMinor("custom_request", 6000, totals), 0);
    assert.equal(
      completion.paymentInsuranceShareMinor("rental", 6000, () => {
        throw new Error("unsupported currency");
      }),
      null,
    );
  });
});
