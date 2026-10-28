import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as nodeModule from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getTableName } from "drizzle-orm";
import * as schema from "@louez/db/schema";
import type Stripe from "stripe";
import { readFeeMetadata } from "@/lib/billing-sync/fee-metadata";
import type { ApplicationFeeInput, ApplicationFeePlan } from "@/lib/pay-as-you-go/metering";
import type { ExtensionAttempt } from "./extension.types";

// The real fee metadata and payment fact helpers load @louez/db: a closed port keeps
// any query away from a real database.
process.env.DATABASE_URL = "mysql://louez:louez@127.0.0.1:1/unreachable";
const directory = mkdtempSync(join(tmpdir(), "louez-extension-tests-"));
const fixturePath = join(directory, "dependencies.cjs");
writeFileSync(fixturePath, "module.exports = globalThis.__louezExtensionTestDependencies;");
after(() => rmSync(directory, { recursive: true }));
const originalEnd = new Date("2030-06-11T10:00:00Z");
const requestedEnd = new Date("2030-06-12T10:00:00Z");
const plan: ExtensionAttempt["plan"] = {
  subtotalAmount: "40",
  totalAmount: "40",
  subtotalExclTax: null,
  taxAmount: null,
  taxRate: null,
  items: [
    {
      id: "item",
      unitPrice: "40",
      totalPrice: "40",
      taxRate: null,
      taxAmount: null,
      priceExclTax: null,
      totalExclTax: null,
    },
  ],
};
const fresh = () => ({
  id: "reservation",
  storeId: "store",
  customerId: "customer",
  status: "confirmed",
  number: "TEST",
  startDate: new Date("2030-06-10T10:00:00Z"),
  endDate: originalEnd,
  store: {
    id: "store",
    slug: "shop",
    stripeAccountId: "acct_test",
    email: "merchant@example.invalid",
    settings: { currency: "EUR" },
  },
  customer: { email: "customer@example.invalid" },
  activity: [] as Array<{ id: string; metadata: ExtensionAttempt }>,
  // The totals the insurance share reads.
  currency: "EUR",
  totalAmount: "20.00",
  subtotalAmount: "20.00",
  depositAmount: "0.00",
  tulipInsuranceAmount: null,
  items: [] as Array<{ productId: string | null; taxRate: string | null; totalPrice: string }>,
});
let reservation = fresh();
let paymentRows: Record<string, unknown>[] = [];
let refundCalls = 0;
let sessionCreates = 0;
let emailCalls = 0;
let contractCalls = 0;
let unavailable = false;
let supplement = 20;
let failRefund = false;
let paidSession: Stripe.Checkout.Session;
const NO_FEE_PLAN: ApplicationFeePlan = {
  applicationFeeCents: 0,
  reservationFeeCents: 0,
  marketplaceFeeCents: 0,
  baseMinor: 0,
  policyScope: "legacy",
  policyVersion: 0,
};
let feePlan = NO_FEE_PLAN;
let feeInputs: ApplicationFeeInput[] = [];
let sessionParams: Stripe.Checkout.SessionCreateParams[] = [];
let intentResponse: Record<string, unknown> = { id: "pi_test", latest_charge: "ch_test" };
let marks: string[] = [];
let serial = Promise.resolve();
class ExtensionError extends Error {}
const fingerprint = () => `${reservation.status}:${reservation.endDate.toISOString()}`;
const tx = {
  update: (table: Parameters<typeof getTableName>[0]) => ({
    set: (value: Record<string, unknown>) => ({
      where: async () => {
        const name = getTableName(table);
        if (name === "reservation_activity")
          reservation.activity[0].metadata = value.metadata as ExtensionAttempt;
        if (name === "reservations") Object.assign(reservation, value);
        if (name === "payments") Object.assign(paymentRows[0], value);
      },
    }),
  }),
  insert: (table: Parameters<typeof getTableName>[0]) => ({
    values: async (value: Record<string, unknown>) => {
      if (getTableName(table) === "reservation_activity")
        reservation.activity.push({
          id: String(value.id),
          metadata: value.metadata as ExtensionAttempt,
        });
      if (getTableName(table) === "payments") paymentRows.push(value);
    },
  }),
};
const dependencies = {
  ...schema,
  env: { NEXT_PUBLIC_APP_URL: "https://example.invalid" },
  db: {
    transaction: async <T>(fn: (transaction: typeof tx) => Promise<T>) => {
      const before = serial;
      let release = () => {};
      serial = new Promise<void>((resolve) => {
        release = resolve;
      });
      await before;
      const snapshot = structuredClone(reservation);
      const oldPayments = structuredClone(paymentRows);
      try {
        return await fn(tx);
      } catch (error) {
        reservation = snapshot;
        paymentRows = oldPayments;
        throw error;
      } finally {
        release();
      }
    },
    query: { stores: { findFirst: async () => reservation.store } },
  },
  ExtensionError,
  cents: (amount: number) => Math.round(amount * 100),
  extensionFingerprint: fingerprint,
  loadExtensionReservation: async (
    _tx: unknown,
    storeId: string,
    reservationId: string,
    customerId?: string,
  ) => {
    if (
      storeId !== reservation.storeId ||
      reservationId !== reservation.id ||
      (customerId && customerId !== reservation.customerId)
    )
      throw new ExtensionError("notFound");
    return reservation;
  },
  parseExtensionEnd: () => requestedEnd,
  quoteExtension: async () => {
    if (unavailable) throw new ExtensionError("unavailable");
    return { preview: { mode: "automatic", supplement, total: 40, currency: "EUR" }, plan };
  },
  resolveDateChangeRequests: async () => {},
  toStripeCents: (amount: number) => Math.round(amount * 100),
  planApplicationFee: async (input: ApplicationFeeInput) => {
    feeInputs.push(input);
    return feePlan;
  },
  markReservation: async (_tx: unknown, row: { id: string }) => {
    marks.push(row.id);
  },
  getStorefrontUrl: (_slug: string, path = "") => `https://example.invalid${path}`,
  generateContract: async () => {
    contractCalls++;
  },
  tryGenerateInvoiceForPayment: async () => ({}),
  markReservationForCalendarSync: async () => {},
  sendReservationModifiedEmail: async () => {
    emailCalls++;
  },
  getLocaleFromCountry: () => "en",
  log: { error: () => {} },
  stripe: {
    checkout: {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams) => {
          sessionCreates++;
          sessionParams.push(params);
          return { id: "cs_test", url: "https://checkout.stripe.com/test", status: "open" };
        },
        retrieve: async () => paidSession,
        expire: async () => ({ status: "expired" }),
      },
    },
    paymentIntents: { retrieve: async () => intentResponse },
    refunds: {
      create: async () => {
        refundCalls++;
        if (failRefund) throw new Error("temporary Stripe failure");
        return { id: "re_test", status: "succeeded" };
      },
    },
  },
};
Reflect.set(globalThis, "__louezExtensionTestDependencies", dependencies);
// The real writer, so the session metadata can be read back.
before(async () => {
  const metering = await import("@/lib/pay-as-you-go/metering");
  Object.assign(dependencies, { buildFeeMetadata: metering.buildFeeMetadata });
});
const intercepted = new Set([
  "@louez/db",
  "@/env",
  "@/lib/stripe/client",
  "@/lib/stripe",
  "@/lib/storefront-url",
  "@/lib/pay-as-you-go",
  "@/lib/pdf/generate",
  "@/lib/invoicing/service",
  "@/lib/integrations/calendar/sync",
  "@/lib/email/send",
  "@/lib/email/i18n",
  "@/lib/evlog",
  "./date-change-request.server",
  "./extension-quote",
]);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    if (context.parentURL?.includes("extension-service.ts") && intercepted.has(specifier))
      return { url: pathToFileURL(fixturePath).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const load = () => import("./extension-service");
const input = {
  storeId: "store",
  customerId: "customer",
  reservationId: "reservation",
  endDate: "2030-06-12T10:00",
  expectedSupplement: 20,
};
const reset = () => {
  reservation = fresh();
  paymentRows = [];
  refundCalls = sessionCreates = emailCalls = contractCalls = 0;
  unavailable = failRefund = false;
  supplement = 20;
  feePlan = NO_FEE_PLAN;
  feeInputs = [];
  sessionParams = [];
  intentResponse = { id: "pi_test", latest_charge: "ch_test" };
  marks = [];
};
const makePaid = (
  metadata: Record<string, string> = {
    reservationId: "reservation",
    extensionId: reservation.activity[0].id,
  },
) => {
  paidSession = {
    id: "cs_test",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    currency: "eur",
    amount_total: 2000,
    payment_intent: "pi_test",
    metadata,
  } as unknown as Stripe.Checkout.Session;
  return paidSession;
};
/** Stripe metadata as Stripe returns it: strings. */
const strings = (metadata: Stripe.MetadataParam | undefined | null): Record<string, string> =>
  Object.fromEntries(Object.entries(metadata ?? {}).map(([key, value]) => [key, String(value)]));

test("payment is required before applying dates; return and webhook replay write only one payment", async () => {
  reset();
  const service = await load();
  const result = await service.startExtension(input);
  assert.equal(result.status, "checkout");
  assert.equal(reservation.endDate.getTime(), originalEnd.getTime());
  assert.equal(reservation.activity[0].metadata.status, "checkout");
  const session = makePaid();
  assert.deepEqual(
    await Promise.all([
      service.completeExtensionPayment(session, "acct_test"),
      service.completeExtensionPayment(session, "acct_test"),
    ]),
    ["confirmed", "confirmed"],
  );
  assert.equal(paymentRows.length, 1);
  assert.equal(reservation.endDate.getTime(), requestedEnd.getTime());
  assert.equal(emailCalls, 2);
  assert.equal(contractCalls, 1);
});

test("a changed reservation or lost stock is refunded, never extended", async () => {
  const service = await load();
  for (const conflict of ["cancelled", "stock"]) {
    reset();
    await service.startExtension(input);
    const session = makePaid();
    if (conflict === "cancelled") reservation.status = "cancelled";
    else unavailable = true;
    assert.equal(await service.completeExtensionPayment(session, "acct_test"), "refunded");
    assert.equal(reservation.endDate.getTime(), originalEnd.getTime());
    assert.equal(refundCalls, 1);
    assert.equal(emailCalls, 0);
    // The payment write and the refund each mark the reservation for billing.
    assert.deepEqual(marks, ["reservation", "reservation"]);
  }
});

test("the extension session carries fee metadata v4, which the payment copies", async () => {
  reset();
  const billing = process.env.LOUEZ_BILLING;
  process.env.LOUEZ_BILLING = "cloud";
  try {
    feePlan = { ...NO_FEE_PLAN, applicationFeeCents: 150, reservationFeeCents: 150 };
    const service = await load();
    await service.startExtension(input);
    const [params] = sessionParams;
    const sessionMetadata = strings(params.metadata);
    const intentMetadata = strings(params.payment_intent_data?.metadata);
    // The fee taken is the planner's, as before.
    assert.equal(params.payment_intent_data?.application_fee_amount, 150);
    assert.deepEqual(feeInputs, [
      {
        storeId: "store",
        reservationId: "reservation",
        kind: "extension",
        chargeMinor: 2000,
        currency: "EUR",
        insuranceShareMinor: 0,
      },
    ]);
    const facts = {
      metadataVersion: 4,
      totalMinor: 150,
      reservationMinor: 150,
      marketplaceMinor: 0,
      baseMinor: 0,
      insuranceShareMinor: 0,
      policyScope: "legacy",
      policyVersion: 0,
      paymentKind: "extension",
    };
    assert.deepEqual(readFeeMetadata(sessionMetadata), facts);
    assert.deepEqual(readFeeMetadata(intentMetadata), facts);
    for (const metadata of [sessionMetadata, intentMetadata]) {
      assert.equal(metadata.reservationId, "reservation");
      assert.equal(metadata.extensionId, reservation.activity[0].id);
      assert.equal(metadata.type, "rental_extension");
      assert.equal(metadata.storeId, "store");
    }

    const session = makePaid(sessionMetadata);
    intentResponse = {
      id: "pi_test",
      latest_charge: { id: "ch_test", created: 1_900_000_000 },
      metadata: intentMetadata,
      application_fee_amount: 150,
    };
    assert.equal(await service.completeExtensionPayment(session, "acct_test"), "confirmed");
    const [payment] = paymentRows;
    assert.deepEqual(
      {
        origin: payment.origin,
        grossMinor: payment.grossMinor,
        insuranceShareMinor: payment.insuranceShareMinor,
        stripeAccountId: payment.stripeAccountId,
        stripeChargeId: payment.stripeChargeId,
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
        origin: "extension",
        grossMinor: 2000,
        insuranceShareMinor: 0,
        stripeAccountId: "acct_test",
        stripeChargeId: "ch_test",
        paidAt: new Date(1_900_000_000_000),
        appFeeTotalMinor: 150,
        appFeeReservationMinor: 150,
        appFeeMarketplaceMinor: 0,
        appFeeBaseMinor: 0,
        appFeePolicyScope: "legacy",
        appFeePolicyVersion: 0,
        appFeeMetadataVersion: 4,
      },
    );
    // applyExtension marks the reservation with the payment, in one transaction.
    assert.deepEqual(marks, ["reservation"]);
  } finally {
    if (billing === undefined) delete process.env.LOUEZ_BILLING;
    else process.env.LOUEZ_BILLING = billing;
  }
});

test("a fee from the store's policy names that policy in the metadata and on the payment", async () => {
  reset();
  const billing = process.env.LOUEZ_BILLING;
  process.env.LOUEZ_BILLING = "cloud";
  try {
    // 250 bps of the 2000 supplement, a public test rate (fees.md §12).
    feePlan = {
      applicationFeeCents: 50,
      reservationFeeCents: 50,
      marketplaceFeeCents: 0,
      baseMinor: 2000,
      policyScope: "store",
      policyVersion: 3,
    };
    const service = await load();
    await service.startExtension(input);
    const [params] = sessionParams;
    assert.equal(params.payment_intent_data?.application_fee_amount, 50);
    const intentMetadata = strings(params.payment_intent_data?.metadata);
    const facts = {
      metadataVersion: 4,
      totalMinor: 50,
      reservationMinor: 50,
      marketplaceMinor: 0,
      baseMinor: 2000,
      insuranceShareMinor: 0,
      policyScope: "store",
      policyVersion: 3,
      paymentKind: "extension",
    };
    assert.deepEqual(readFeeMetadata(strings(params.metadata)), facts);
    assert.deepEqual(readFeeMetadata(intentMetadata), facts);

    intentResponse = {
      id: "pi_test",
      latest_charge: { id: "ch_test", created: 1_900_000_000 },
      metadata: intentMetadata,
      application_fee_amount: 50,
    };
    const session = makePaid(strings(params.metadata));
    assert.equal(await service.completeExtensionPayment(session, "acct_test"), "confirmed");
    const [payment] = paymentRows;
    assert.deepEqual(
      [
        payment.appFeeTotalMinor,
        payment.appFeeBaseMinor,
        payment.appFeePolicyScope,
        payment.appFeePolicyVersion,
      ],
      [50, 2000, "store", 3],
    );
  } finally {
    if (billing === undefined) delete process.env.LOUEZ_BILLING;
    else process.env.LOUEZ_BILLING = billing;
  }
});

test("with platform billing off, the extension session has no fee metadata", async () => {
  reset();
  const service = await load();
  await service.startExtension(input);
  const [params] = sessionParams;
  assert.deepEqual(strings(params.metadata), {
    reservationId: "reservation",
    extensionId: reservation.activity[0].id,
    type: "rental_extension",
  });
  assert.equal(readFeeMetadata(strings(params.payment_intent_data?.metadata)), null);
});

test("a failed refund remains recoverable and is not duplicated after success", async () => {
  reset();
  const service = await load();
  await service.startExtension(input);
  const session = makePaid();
  unavailable = true;
  failRefund = true;
  await assert.rejects(service.completeExtensionPayment(session, "acct_test"), /temporary/);
  assert.equal(reservation.activity[0].metadata.status, "refund_pending");
  failRefund = false;
  assert.equal(await service.completeExtensionPayment(session, "acct_test"), "refunded");
  assert.equal(await service.completeExtensionPayment(session, "acct_test"), "refunded");
  assert.equal(paymentRows.length, 1);
  assert.equal(refundCalls, 2);
});

test("unpaid or mismatched sessions cannot extend a reservation", async () => {
  reset();
  const service = await load();
  await service.startExtension(input);
  const session = makePaid();
  assert.equal(
    await service.completeExtensionPayment({ ...session, payment_status: "unpaid" }, "acct_test"),
    "processing",
  );
  await assert.rejects(
    service.completeExtensionPayment({ ...session, amount_total: 1 }, "acct_test"),
    /paymentMismatch/,
  );
  assert.equal(paymentRows.length, 0);
  assert.equal(reservation.endDate.getTime(), originalEnd.getTime());
});

test("free extensions are idempotent and do not create a Stripe session", async () => {
  reset();
  supplement = 0;
  const service = await load();
  assert.equal(
    (await service.startExtension({ ...input, expectedSupplement: 0 })).status,
    "confirmed",
  );
  assert.equal(
    (await service.startExtension({ ...input, expectedSupplement: 0 })).status,
    "confirmed",
  );
  assert.equal(reservation.activity.length, 1);
  assert.equal(sessionCreates, 0);
  assert.equal(contractCalls, 1);
});

test("another customer cannot start an extension; stale displayed prices are refused", async () => {
  reset();
  const service = await load();
  await assert.rejects(service.startExtension({ ...input, customerId: "other" }), /notFound/);
  await assert.rejects(service.startExtension({ ...input, expectedSupplement: 1 }), /priceChanged/);
  assert.equal(reservation.activity.length, 0);
});

test("cancelling an unpaid checkout releases the hold, while a completed payment is reconciled", async () => {
  const service = await load();
  reset();
  await service.startExtension(input);
  makePaid();
  paidSession = { ...paidSession, status: "open", payment_status: "unpaid" };
  await service.cancelExtension("store", "reservation", "customer", reservation.activity[0].id);
  assert.equal(reservation.activity[0].metadata.status, "cancelled");
  assert.equal(reservation.endDate.getTime(), originalEnd.getTime());
  reset();
  await service.startExtension(input);
  makePaid();
  await service.cancelExtension("store", "reservation", "customer", reservation.activity[0].id);
  assert.equal(reservation.activity[0].metadata.status, "confirmed");
});
