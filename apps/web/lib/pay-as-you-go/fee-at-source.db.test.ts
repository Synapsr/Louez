import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import { eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { log } from "@/lib/evlog";

import type { LegacyFeeReportEvent } from "./legacy-fee-repair";
import type { ApplicationFeeInput } from "./metering";

// The fee at source of a store the billing service bills (louez-billing docs/api,
// fees.md §8; m2-plan L8). Every Stripe application fee Louez sets comes from the
// store's policy when the session is created, and fee metadata v4 and the payment's
// app_fee_* columns name that policy. Louez's legacy pay-as-you-go code writes nothing
// for such a store, and BILLING_GATE_DISABLED lets it take bookings while its policy
// refuses them, fee included. fee-shadow.db.test.ts covers the stores the legacy
// planner charges, legacy-guard.db.test.ts the rest of the legacy guard.
//
// The policies use the public test values of fees.md §12 (Q33): 123 and 250 bps, a
// 150 marketplace fee, a minimum of 50 and a maximum of 300. Stripe is stubbed: no
// network. The database is real.

process.env.SKIP_ENV_VALIDATION = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
delete process.env.NEXT_PUBLIC_POSTHOG_KEY;

const FILES_SDK = new URL("../../node_modules/files-sdk/dist/", import.meta.url);
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    // The customer session imports "server-only", which throws outside Next.
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    // files-sdk, which it loads too, exports ESM only, through an "import" condition the
    // test's require misses.
    if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
      const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
      return { url: new URL(entry, FILES_SDK).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const NEW_STORES_FROM = "2026-06-01T00:00:00Z";
const OLD = "2026-05-01T00:00:00Z";
const NEW = "2026-07-01T00:00:00Z";

/** On `*`: the store has no card yet, so its reservations are refused. */
const NEW_STORE = "fas_new";
/** Its own version: 123 bps, a minimum of 50 and a maximum of 300. */
const OWN_STORE = "fas_own";
/** Its own version takes no fee. */
const NONE_STORE = "fas_none";
/** Created before the cutoff, billed by the service from its version 2. */
const SWITCHED_STORE = "fas_switch";
/** Created before the cutoff, with no policy: the legacy planner charges it. */
const LEGACY_STORE = "fas_old";
/** As LEGACY_STORE, with no subscription row. */
const ROWLESS_STORE = "fas_old_rowless";
/** A new store whose version carries the service's platform customer. */
const CARD_STORE = "fas_card";

const PERCENT = {
  kind: "percent",
  rateBps: 250,
  minMinor: 0,
  maxMinor: null,
  excludeInsurance: true,
  appliesTo: ["rental", "extension", "adjustment"],
} as const;
const base = {
  schema: "louez.billing.policy/1",
  issuedAt: "2026-05-20T10:00:00Z",
  newStoresCreatedFrom: null,
  currency: "EUR",
  applicationFee: PERCENT,
  marketplaceFeeMinor: 150,
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
  offerKey: "test-commission",
  invoicing: "service",
};
const POLICIES = [
  {
    ...base,
    storeId: "*",
    version: 1,
    effectiveFrom: NEW_STORES_FROM,
    newStoresCreatedFrom: NEW_STORES_FROM,
    reservations: { allowed: false, reason: "payment_method_required" },
  },
  {
    ...base,
    storeId: OWN_STORE,
    version: 1,
    effectiveFrom: NEW,
    applicationFee: { ...PERCENT, rateBps: 123, minMinor: 50, maxMinor: 300 },
  },
  {
    ...base,
    storeId: NONE_STORE,
    version: 1,
    effectiveFrom: NEW,
    invoicing: "none",
    applicationFee: { kind: "none" },
    marketplaceFeeMinor: 0,
  },
  {
    ...base,
    storeId: SWITCHED_STORE,
    version: 1,
    effectiveFrom: OLD,
    offerKey: "test-legacy",
    invoicing: "louez_legacy",
    applicationFee: { kind: "per_reservation", amountMinor: 90 },
  },
  { ...base, storeId: SWITCHED_STORE, version: 2, effectiveFrom: "2026-09-01T00:00:00Z" },
  {
    ...base,
    storeId: CARD_STORE,
    version: 1,
    effectiveFrom: NEW,
    stripeCustomerId: "cus_ServiceCard",
  },
];

const STORES: ReadonlyArray<readonly [string, string]> = [
  [NEW_STORE, NEW],
  [OWN_STORE, NEW],
  [NONE_STORE, NEW],
  [SWITCHED_STORE, OLD],
  [LEGACY_STORE, OLD],
  [ROWLESS_STORE, OLD],
  [CARD_STORE, NEW],
];

const NO_FACTS = {
  isMarketplace: false,
  marketplaceWaived: false,
  marketplaceAlreadyTaken: false,
  reservationAlreadyBillable: false,
  reservationFeeAlreadyTaken: false,
};
const NO_STRIPE_FEE = { applicationFeeCents: 0, reservationFeeCents: 0, marketplaceFeeCents: 0 };

const lineSchema = z.object({ billing: z.record(z.string(), z.unknown()) });
const spyInfo = () => mock.method(log, "info", () => {});

describe("the policy's fee at source (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let metering: typeof import("./metering");
  let lock: typeof import("./pricing-lock");
  let billing: typeof import("./billing");
  let legacyRun: typeof import("./legacy-run");
  let repair: typeof import("./legacy-fee-repair");
  let effects: typeof import("@/lib/billing/reservation-effects");
  let feeMetadata: typeof import("@/lib/billing-sync/fee-metadata");
  let completion: typeof import("@/lib/stripe/payment-completion");
  let paymentSession: typeof import("@/lib/reservations/payment-session");
  let smsTopup: typeof import("@/lib/stripe/sms-topup");
  const sessions: Stripe.Checkout.SessionCreateParams[] = [];
  const names = [
    "LOUEZ_BILLING",
    "BILLING_SERVICE_URL",
    "BILLING_NEW_STORES_FROM",
    "BILLING_GATE_DISABLED",
  ] as const;
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  let info: ReturnType<typeof spyInfo>;

  before(async () => {
    database = await createTestDatabase("fee_at_source");
    louezDb = await import("@louez/db");
    metering = await import("./metering");
    lock = await import("./pricing-lock");
    billing = await import("./billing");
    legacyRun = await import("./legacy-run");
    repair = await import("./legacy-fee-repair");
    effects = await import("@/lib/billing/reservation-effects");
    feeMetadata = await import("@/lib/billing-sync/fee-metadata");
    completion = await import("@/lib/stripe/payment-completion");
    paymentSession = await import("@/lib/reservations/payment-session");
    smsTopup = await import("@/lib/stripe/sms-topup");
    const { getStripe } = await import("@/lib/stripe/client");
    Reflect.set(
      getStripe().checkout.sessions,
      "create",
      async (params: Stripe.Checkout.SessionCreateParams) => {
        sessions.push(params);
        return {
          id: `cs_fas_${sessions.length}`,
          url: "https://checkout.stripe.test/pay",
          expires_at: 1_900_000_000,
        };
      },
    );

    await louezDb.db.insert(louezDb.stores).values(
      STORES.map(([id, createdAt]) => ({
        id,
        userId: `user_${id}`,
        name: id,
        slug: id.replaceAll("_", "-"),
        createdAt: new Date(createdAt),
        stripeAccountId: `acct_${id}`,
        stripeChargesEnabled: true,
      })),
    );
    await louezDb.db.insert(louezDb.billingPolicies).values(
      POLICIES.map((body) => ({
        storeId: body.storeId,
        version: body.version,
        effectiveFrom: new Date(body.effectiveFrom),
        body,
      })),
    );
    const payAsYouGo = (storeId: string) => ({
      id: `sub_${storeId}`,
      storeId,
      billingMode: "pay_as_you_go" as const,
      payAsYouGoConfig: { flatRateCents: 123 },
      pricingVersion: "payg-ladder-v1" as const,
      freeReservationsGranted: 0,
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    });
    // The switched store kept the row of its legacy months.
    await louezDb.db
      .insert(louezDb.subscriptions)
      .values([payAsYouGo(LEGACY_STORE), payAsYouGo(SWITCHED_STORE)]);
    await louezDb.db.insert(louezDb.customers).values({
      id: "cust_fas",
      storeId: NEW_STORE,
      email: "renter@example.invalid",
      firstName: "Renter",
      lastName: "Test",
    });
    const reservation = (
      id: string,
      storeId: string,
      extra: { source?: string; tulipInsuranceAmount?: string } = {},
    ) => ({
      id,
      storeId,
      customerId: "cust_fas",
      number: id,
      status: "confirmed" as const,
      startDate: new Date("2030-11-20T09:00:00Z"),
      endDate: new Date("2030-11-22T09:00:00Z"),
      subtotalAmount: "200.00",
      depositAmount: "0.00",
      totalAmount: "200.00",
      ...extra,
    });
    await louezDb.db
      .insert(louezDb.reservations)
      .values([
        reservation("res_fas_plain", NEW_STORE),
        reservation("res_fas_market", NEW_STORE, { source: "marketplace" }),
        reservation("res_fas_mkt_paid", NEW_STORE, { source: "marketplace" }),
        reservation("res_fas_session", NEW_STORE, { tulipInsuranceAmount: "40.00" }),
        reservation("res_fas_own", OWN_STORE),
        reservation("res_fas_none", NONE_STORE),
        reservation("res_fas_switch", SWITCHED_STORE),
        reservation("res_fas_old", LEGACY_STORE),
      ]);
    // The marketplace fee was taken at source on an earlier rental payment.
    await louezDb.db.insert(louezDb.payments).values({
      id: "pay_fas_mkt_paid",
      reservationId: "res_fas_mkt_paid",
      amount: "50.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      origin: "customer_session",
      appFeeTotalMinor: 275,
      appFeeReservationMinor: 125,
      appFeeMarketplaceMinor: 150,
      appFeeBaseMinor: 5_000,
      appFeePolicyScope: "default",
      appFeePolicyVersion: 1,
      appFeeMetadataVersion: 4,
    });
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BILLING_NEW_STORES_FROM = NEW_STORES_FROM;
    delete process.env.BILLING_GATE_DISABLED;
    sessions.length = 0;
    info = spyInfo();
  });
  afterEach(() => {
    mock.restoreAll();
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const rental = (storeId: string, reservationId: string, chargeMinor = 20_000) => ({
    storeId,
    reservationId,
    kind: "rental" as const,
    chargeMinor,
    currency: "EUR",
    insuranceShareMinor: 0,
  });
  const lines = () => info.mock.calls.map((call) => lineSchema.parse(call.arguments[0]).billing);
  const lastLine = () => {
    const all = lines();
    return all[all.length - 1];
  };
  const fromDefault = { policyScope: "default", policyVersion: 1 } as const;

  test("the fee comes from the policy, the insurance share out of its base, and is logged", async () => {
    const plan = await metering.planApplicationFee({
      ...rental(NEW_STORE, "res_fas_plain"),
      insuranceShareMinor: 4_000,
    });
    // 250 bps of 16_000.
    assert.deepEqual(plan, {
      applicationFeeCents: 400,
      reservationFeeCents: 400,
      marketplaceFeeCents: 0,
      baseMinor: 16_000,
      ...fromDefault,
    });
    // No shadow: the fee is the policy's.
    assert.deepEqual(lines(), [
      {
        event: "fee_at_source",
        storeId: NEW_STORE,
        reservationId: "res_fas_plain",
        kind: "rental",
        chargeMinor: 20_000,
        currency: "EUR",
        insuranceShareMinor: 4_000,
        policy: { source: "default", version: 1, invoicing: "service" },
        facts: NO_FACTS,
        fee: { totalMinor: 400, reservationMinor: 400, marketplaceMinor: 0, baseMinor: 16_000 },
      },
    ]);
  });

  test("the marketplace fee is taken once per reservation, on rental payments, in every session", async () => {
    const plan = (input: Partial<ApplicationFeeInput> & { reservationId: string }) =>
      metering.planApplicationFee({ ...rental(NEW_STORE, input.reservationId), ...input });

    // The storefront checkout too: the legacy planner took it in customer sessions only.
    assert.deepEqual(await plan({ reservationId: "res_fas_market" }), {
      applicationFeeCents: 650,
      reservationFeeCents: 500,
      marketplaceFeeCents: 150,
      baseMinor: 20_000,
      ...fromDefault,
    });
    // An extension pays the percent alone.
    assert.deepEqual(
      await plan({ reservationId: "res_fas_market", kind: "extension", chargeMinor: 2_000 }),
      {
        applicationFeeCents: 50,
        reservationFeeCents: 50,
        marketplaceFeeCents: 0,
        baseMinor: 2_000,
        ...fromDefault,
      },
    );
    // A completed payment already took it.
    assert.equal((await plan({ reservationId: "res_fas_mkt_paid" })).marketplaceFeeCents, 0);
    // Another currency than the policy's skips the flat amount.
    assert.deepEqual(await plan({ reservationId: "res_fas_market", currency: "usd" }), {
      applicationFeeCents: 500,
      reservationFeeCents: 500,
      marketplaceFeeCents: 0,
      baseMinor: 20_000,
      ...fromDefault,
    });
    // The store keeps 1 minor unit: the marketplace fee fits, the percent is dropped whole.
    assert.deepEqual(await plan({ reservationId: "res_fas_market", chargeMinor: 151 }), {
      applicationFeeCents: 150,
      reservationFeeCents: 0,
      marketplaceFeeCents: 150,
      baseMinor: 151,
      ...fromDefault,
    });

    await louezDb.db.insert(louezDb.storeMarketplaceChannels).values({
      id: "chan_fas_new",
      storeId: NEW_STORE,
      lifetimeFeeWaiverAt: new Date("2026-07-02T00:00:00Z"),
    });
    try {
      assert.equal((await plan({ reservationId: "res_fas_market" })).marketplaceFeeCents, 0);
    } finally {
      await louezDb.db
        .delete(louezDb.storeMarketplaceChannels)
        .where(eq(louezDb.storeMarketplaceChannels.storeId, NEW_STORE));
    }
  });

  test("a payment kind outside appliesTo pays nothing, and names the policy that said so", async () => {
    assert.deepEqual(
      await metering.planApplicationFee({
        ...rental(NEW_STORE, "res_fas_plain"),
        kind: "custom_request",
      }),
      { ...NO_STRIPE_FEE, baseMinor: 0, ...fromDefault },
    );
  });

  test("the store's own version wins, with its minimum and maximum", async () => {
    const own = { policyScope: "store", policyVersion: 1 } as const;
    assert.deepEqual(await metering.planApplicationFee(rental(OWN_STORE, "res_fas_own", 2_000)), {
      applicationFeeCents: 50,
      reservationFeeCents: 50,
      marketplaceFeeCents: 0,
      baseMinor: 2_000,
      ...own,
    });
    assert.deepEqual(await metering.planApplicationFee(rental(OWN_STORE, "res_fas_own", 100_000)), {
      applicationFeeCents: 300,
      reservationFeeCents: 300,
      marketplaceFeeCents: 0,
      baseMinor: 100_000,
      ...own,
    });
    // A version that says `none` takes nothing, and reads no facts.
    assert.deepEqual(await metering.planApplicationFee(rental(NONE_STORE, "res_fas_none")), {
      ...NO_STRIPE_FEE,
      baseMinor: 0,
      policyScope: "store",
      policyVersion: 1,
    });
    assert.equal(lastLine()?.facts, null);
  });

  test("a store switched to the service pays its version, and a legacy store keeps the legacy planner", async () => {
    assert.deepEqual(await metering.planApplicationFee(rental(SWITCHED_STORE, "res_fas_switch")), {
      applicationFeeCents: 500,
      reservationFeeCents: 500,
      marketplaceFeeCents: 0,
      baseMinor: 20_000,
      policyScope: "store",
      policyVersion: 2,
    });

    const legacy = await metering.planStripeFees({
      storeId: LEGACY_STORE,
      reservationId: "res_fas_old",
      chargeCents: 20_000,
    });
    assert.equal(legacy.applicationFeeCents, 123);
    assert.deepEqual(await metering.planApplicationFee(rental(LEGACY_STORE, "res_fas_old")), {
      ...legacy,
      baseMinor: 0,
      policyScope: "legacy",
      policyVersion: 0,
    });
    assert.equal(lastLine()?.event, "fee_shadow");

    // Without BILLING_SERVICE_URL every store is legacy, a new one included. Its
    // missing pricing is then reported.
    delete process.env.BILLING_SERVICE_URL;
    mock.method(log, "error", () => {});
    assert.equal(
      (await metering.planApplicationFee(rental(NEW_STORE, "res_fas_plain"))).policyScope,
      "legacy",
    );
  });

  test("a customer session sets the policy's fee, its metadata names the policy, and the payment copies it", async () => {
    const result = await paymentSession.createReservationPaymentSessionForCustomer(
      "fas-new",
      "res_fas_session",
      "cust_fas",
      "account_page",
    );
    assert.ok(!("error" in result), JSON.stringify(result));
    const [params] = sessions;
    assert.ok(params);
    // 250 bps of the 20_000 charge without its 4_000 insurance share.
    assert.equal(params.payment_intent_data?.application_fee_amount, 400);
    const intentMetadata = Object.fromEntries(
      Object.entries(params.payment_intent_data?.metadata ?? {}).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
    const facts = feeMetadata.readFeeMetadata(intentMetadata);
    assert.deepEqual(facts, {
      metadataVersion: 4,
      totalMinor: 400,
      reservationMinor: 400,
      marketplaceMinor: 0,
      baseMinor: 16_000,
      insuranceShareMinor: 4_000,
      policyScope: "default",
      policyVersion: 1,
      paymentKind: "rental",
    });
    assert.equal(intentMetadata.storeId, NEW_STORE);

    const paidAt = new Date();
    const claim = await completion.claimCompletedCheckoutPayment({
      reservationId: "res_fas_session",
      amount: 200,
      currency: "EUR",
      stripeCheckoutSessionId: "cs_fas_1",
      stripePaymentIntentId: "pi_fas_session",
      stripeChargeId: "ch_fas_session",
      stripePaymentMethodId: null,
      stripeAccountId: "acct_fas_new",
      claimedAt: paidAt,
      paidAt,
      grossMinor: 20_000,
      insuranceShareMinor: facts?.insuranceShareMinor ?? null,
      origin: "customer_session",
      paymentRequestId: null,
      feeFacts: facts,
    });
    const payment = await louezDb.db.query.payments.findFirst({
      where: eq(louezDb.payments.id, claim.paymentId),
      columns: {
        status: true,
        insuranceShareMinor: true,
        appFeeTotalMinor: true,
        appFeeReservationMinor: true,
        appFeeMarketplaceMinor: true,
        appFeeBaseMinor: true,
        appFeePolicyScope: true,
        appFeePolicyVersion: true,
        appFeeMetadataVersion: true,
      },
    });
    assert.deepEqual(payment, {
      status: "completed",
      insuranceShareMinor: 4_000,
      appFeeTotalMinor: 400,
      appFeeReservationMinor: 400,
      appFeeMarketplaceMinor: 0,
      appFeeBaseMinor: 16_000,
      appFeePolicyScope: "default",
      appFeePolicyVersion: 1,
      appFeeMetadataVersion: 4,
    });

    // The Connect webhook then records the legacy fee rows of the charge: none here.
    const recorded = {
      storeId: NEW_STORE,
      reservationId: "res_fas_session",
      source: "online" as const,
      currency: "EUR",
      paymentId: claim.paymentId,
      stripePaymentIntentId: "pi_fas_session",
      at: paidAt,
    };
    assert.deepEqual(
      await metering.recordReservationFee({ ...recorded, collectedAmountCents: 400 }),
      { recorded: false, reason: "not_legacy_billed" },
    );
    assert.deepEqual(
      await metering.recordMarketplaceFee({ ...recorded, collectedAmountCents: 150 }),
      { recorded: false, reason: "not_legacy_billed" },
    );
    const rows = await louezDb.db
      .select({ id: louezDb.platformFees.id })
      .from(louezDb.platformFees)
      .where(eq(louezDb.platformFees.storeId, NEW_STORE));
    assert.deepEqual(rows, []);
  });

  test("BILLING_GATE_DISABLED=true: a store its policy refuses takes bookings, and pays the fee", async () => {
    const booking = (id: string) =>
      louezDb.db.transaction((tx) =>
        louezDb.insertReservation(tx, {
          id,
          storeId: NEW_STORE,
          customerId: "cust_fas",
          number: id,
          status: "confirmed",
          startDate: new Date("2030-12-01T09:00:00Z"),
          endDate: new Date("2030-12-03T09:00:00Z"),
          subtotalAmount: "200.00",
          depositAmount: "0.00",
          totalAmount: "200.00",
          source: "marketplace",
        }),
      );
    // The `*` version refuses reservations: the gate is closed.
    await assert.rejects(booking("res_fas_gate_closed"), (error: unknown) =>
      louezDb.isStoreNotAcceptingReservationsError(error),
    );

    process.env.BILLING_GATE_DISABLED = "true";
    const { effects: fees } = await booking("res_fas_gate_open");
    await effects.runReservationEffects(fees);
    assert.deepEqual(await metering.planApplicationFee(rental(NEW_STORE, "res_fas_gate_open")), {
      applicationFeeCents: 650,
      reservationFeeCents: 500,
      marketplaceFeeCents: 150,
      baseMinor: 20_000,
      ...fromDefault,
    });
    // Its confirmation wrote no legacy fee, as for every store the service bills.
    const rows = await louezDb.db
      .select({ id: louezDb.platformFees.id })
      .from(louezDb.platformFees)
      .where(eq(louezDb.platformFees.reservationId, "res_fas_gate_open"));
    assert.deepEqual(rows, []);
  });

  test("the legacy pricing, the monthly run and its catch-up leave a store the service bills alone", async () => {
    await lock.ensureSubscriptionRow(louezDb.db, NEW_STORE);
    await lock.addFreeReservations(louezDb.db, NEW_STORE, 10);
    assert.equal(
      await louezDb.db.query.subscriptions.findFirst({
        where: eq(louezDb.subscriptions.storeId, NEW_STORE),
        columns: { id: true },
      }),
      undefined,
    );
    assert.deepEqual(await metering.voidReservationFee("res_fas_session"), { voided: false });

    // Each fact at its own time: the switched store is legacy in August only. A store
    // that does not exist stays legacy, as the resolver's last case.
    const facts = [
      { storeId: SWITCHED_STORE, at: new Date("2026-08-15T10:00:00Z") },
      { storeId: SWITCHED_STORE, at: new Date("2026-09-15T10:00:00Z") },
      { storeId: NEW_STORE, at: new Date("2026-08-15T10:00:00Z") },
      { storeId: "fas_missing", at: new Date("2026-09-15T10:00:00Z") },
    ];
    assert.deepEqual(await louezDb.legacyBilledFacts(louezDb.db, facts), [facts[0], facts[3]]);

    // Its legacy row stays from its legacy months: the run bills August, not September.
    assert.ok((await billing.monthlyBillingStoreIds("2026-08")).includes(SWITCHED_STORE));
    for (const month of ["2026-09", "2026-10"]) {
      assert.ok(!(await billing.monthlyBillingStoreIds(month)).includes(SWITCHED_STORE), month);
      assert.ok(!(await legacyRun.unbilledStoreIds(month)).includes(SWITCHED_STORE), month);
      assert.ok((await legacyRun.unbilledStoreIds(month)).includes(LEGACY_STORE), month);
    }
  });

  test("the fee report lists no fee to record for a store the service bills", async () => {
    const billableAt = new Date(Date.now() - 2 * 86_400_000);
    await louezDb.db
      .update(louezDb.reservations)
      .set({ billableAt })
      .where(inArray(louezDb.reservations.id, ["res_fas_plain", "res_fas_market", "res_fas_old"]));
    const events: Array<{ kind: string; storeIds: string[] }> = [];
    const collect = (event: LegacyFeeReportEvent) => {
      events.push({
        kind: event.payg.kind,
        storeIds: event.payg.candidates.map((candidate) => candidate.storeId),
      });
    };
    const report = await repair.reportLegacyFees(new Date(), {
      log: { info: collect, warn: collect },
    });
    assert.equal(report.reported, true);
    const listed = (kind: string) =>
      new Set(events.filter((event) => event.kind === kind).flatMap((event) => event.storeIds));
    assert.ok(listed("record").has(LEGACY_STORE));
    for (const kind of ["record", "marketplace"]) {
      assert.ok(!listed(kind).has(NEW_STORE), kind);
    }

    // Without BILLING_SERVICE_URL every store is legacy, and listed as before.
    delete process.env.BILLING_SERVICE_URL;
    events.length = 0;
    await repair.reportLegacyFees(new Date(), { log: { info: collect, warn: collect } });
    assert.ok(listed("record").has(NEW_STORE));
    assert.ok(listed("marketplace").has(NEW_STORE));
  });

  test("its missing pricing is not reported as a legacy store's would be", async () => {
    const error = mock.method(log, "error", () => {});
    await metering.getStoreBilling(CARD_STORE);
    assert.equal(error.mock.callCount(), 0);
    await metering.getStoreBilling(ROWLESS_STORE);
    assert.equal(error.mock.callCount(), 1);
    assert.match(JSON.stringify(error.mock.calls[0]?.arguments), /fas_old_rowless has no frozen/);
  });

  test("an SMS top-up charges the service's customer and writes no legacy pricing", async () => {
    const result = await smsTopup.createSmsTopupCheckoutSession({
      storeId: CARD_STORE,
      quantity: 100,
      successUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/cancel",
      translations: { productName: "SMS", productDescription: "SMS" },
    });
    assert.ok(result.sessionId);
    assert.deepEqual(
      sessions.map((params) => [params.customer, params.metadata?.type]),
      [["cus_ServiceCard", "sms_topup"]],
    );
    assert.equal(
      await louezDb.db.query.subscriptions.findFirst({
        where: eq(louezDb.subscriptions.storeId, CARD_STORE),
        columns: { id: true },
      }),
      undefined,
    );
  });
});
