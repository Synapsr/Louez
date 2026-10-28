import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, afterEach, before, describe, test } from "node:test";

import type { Database, ReservationBillingEffect } from "@louez/db";

// With LOUEZ_BILLING off, the billing paths must return before touching the database
// (louez-billing docs/plans/design.md §7.2).
// DATABASE_URL points at a closed port: any query would fail with ECONNREFUSED. The
// variables are set rather than deleted, because dotenv (loaded by @louez/db) never
// overrides a variable that is already set.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = "mysql://louez:louez@127.0.0.1:1/unreachable";
process.env.LOUEZ_BILLING = "off";
// Credit layers an operator opted into: billing off must still switch them off.
process.env.AI_CREDITS_ENABLED = "true";
process.env.AI_PHONE_NUMBER_RENTAL_CREDITS = "30";
// Stripe Connect without the plan prices (design §7.2): online payments still work.
process.env.STRIPE_SECRET_KEY = "sk_test_billing_off";
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_connect_billing_off";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_platform_billing_off";
delete process.env.STRIPE_PRICE_PRO_MONTHLY;
delete process.env.STRIPE_PRICE_ULTRA_MONTHLY;

// Some modules import "server-only", which throws outside Next.
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});

/** A database stand-in that records every call and never answers. */
function spyDatabase() {
  const calls: string[] = [];
  const handler: ProxyHandler<object> = {
    get(_target, property) {
      calls.push(String(property));
      throw new Error(`database touched: ${String(property)}`);
    },
  };
  return { executor: new Proxy({}, handler) as Database, calls };
}

const feeEffects: ReservationBillingEffect[] = [
  {
    type: "legacy_fee.record",
    storeId: "store",
    reservationId: "reservation",
    marketplace: true,
    at: new Date("2026-01-15T10:00:00Z"),
  },
  { type: "legacy_fee.void", storeId: "store", reservationId: "reservation" },
];

describe("billing off", () => {
  let metering: typeof import("./metering");
  let lock: typeof import("./pricing-lock");
  let newStore: typeof import("./new-store-subscription");
  let stripeSubscriptions: typeof import("@/lib/stripe/subscriptions");
  let planLimits: typeof import("@/lib/plan-limits");
  let plans: typeof import("@/lib/plans");
  let numberBilling: typeof import("@/lib/ai/phone/number-billing");
  let reservationEffects: typeof import("@/lib/billing/reservation-effects");
  let legacyFeeRepair: typeof import("./legacy-fee-repair");
  let database: typeof import("@louez/db");
  let rateLimit: typeof import("@/lib/ai/rate-limit");
  let multiStore: typeof import("@/lib/dashboard/multi-store-metrics");
  let referralInvite: typeof import("@/lib/referral/invite");
  let requireBilling: typeof import("@/lib/billing/require-billing");
  let stripeClient: typeof import("@/lib/stripe/client");

  /** The real runner, with its failures collected: it logs them instead of throwing. */
  async function runFeeEffects(): Promise<string[]> {
    const errors: string[] = [];
    await reservationEffects.createLegacyFeeEffectRunner({
      log: { error: (_tag, message) => errors.push(message), info: () => undefined },
    })(feeEffects);
    return errors;
  }

  before(async () => {
    metering = await import("./metering");
    lock = await import("./pricing-lock");
    newStore = await import("./new-store-subscription");
    stripeSubscriptions = await import("@/lib/stripe/subscriptions");
    planLimits = await import("@/lib/plan-limits");
    plans = await import("@/lib/plans");
    numberBilling = await import("@/lib/ai/phone/number-billing");
    reservationEffects = await import("@/lib/billing/reservation-effects");
    legacyFeeRepair = await import("./legacy-fee-repair");
    database = await import("@louez/db");
    rateLimit = await import("@/lib/ai/rate-limit");
    multiStore = await import("@/lib/dashboard/multi-store-metrics");
    referralInvite = await import("@/lib/referral/invite");
    requireBilling = await import("@/lib/billing/require-billing");
    stripeClient = await import("@/lib/stripe/client");
  });

  afterEach(() => {
    process.env.LOUEZ_BILLING = "off";
  });

  after(async () => {
    // The last test's refused connection surfaces again when the pool closes.
    await database.db.$client.end().catch(() => undefined);
  });

  test("no Stripe Connect fee is planned, reeent fee included", async () => {
    const plan = await metering.planStripeFees({
      storeId: "store",
      reservationId: "reservation",
      chargeCents: 10_000,
      includeMarketplaceFee: true,
    });

    assert.deepEqual(plan, {
      applicationFeeCents: 0,
      reservationFeeCents: 0,
      marketplaceFeeCents: 0,
    });
  });

  test("the fee at source plans no fee and reads no policy", async () => {
    // Even with a service URL: billing off never reads the policy cache (README §12).
    const serviceUrl = process.env.BILLING_SERVICE_URL;
    process.env.BILLING_SERVICE_URL = "https://billing.example.test";
    try {
      for (const kind of ["rental", "extension", "custom_request"] as const) {
        const plan = await metering.planApplicationFee({
          storeId: "store",
          reservationId: "reservation",
          kind,
          chargeMinor: 10_000,
          currency: "EUR",
          insuranceShareMinor: 0,
          includeMarketplaceFee: true,
        });
        assert.deepEqual(plan, {
          applicationFeeCents: 0,
          reservationFeeCents: 0,
          marketplaceFeeCents: 0,
          baseMinor: 0,
          policyScope: "legacy",
          policyVersion: 0,
        });
      }
    } finally {
      if (serviceUrl === undefined) delete process.env.BILLING_SERVICE_URL;
      else process.env.BILLING_SERVICE_URL = serviceUrl;
    }
  });

  test("fee recording and voiding write nothing", async () => {
    assert.deepEqual(
      await metering.recordReservationFee({
        storeId: "store",
        reservationId: "reservation",
        source: "manual",
      }),
      { recorded: false, reason: "billing_off" },
    );
    assert.deepEqual(
      await metering.recordMarketplaceFee({
        storeId: "store",
        reservationId: "reservation",
        source: "manual",
      }),
      { recorded: false, reason: "billing_off" },
    );
    assert.deepEqual(await metering.voidReservationFee("reservation"), { voided: false });
  });

  test("the reservation fee effects run without a database call", async () => {
    assert.deepEqual(await runFeeEffects(), []);
  });

  test("the legacy fee report returns before any database call", async () => {
    assert.deepEqual(await legacyFeeRepair.reportLegacyFees(new Date("2026-03-02T04:45:00Z")), {
      reported: false,
      reason: "billing_off",
    });
  });

  test("no subscription row is created and no allowance is written", async () => {
    const { executor, calls } = spyDatabase();

    await lock.ensureSubscriptionRow(executor, "store");
    await lock.ensurePlanRow(executor, "store");
    await lock.addFreeReservations(executor, "store", 30);
    await lock.raiseFreeReservations(executor, "store", 30);
    assert.equal(
      await newStore.insertNewStoreSubscription(executor, {
        storeId: "store",
        currency: "eur",
        referred: true,
      }),
      false,
    );
    // The legacy guard reads no policy: nobody is billed.
    assert.equal(await database.legacyBillingAppliesAt(executor, "store", new Date()), false);
    assert.deepEqual(await database.legacyBilledStoreIds(executor, ["store"], new Date()), []);

    assert.deepEqual(calls, []);
  });

  test("a platform charge is refused before any Stripe or database call", async () => {
    await assert.rejects(
      stripeSubscriptions.getPlatformCustomerId("store"),
      (error: Error) => error.name === "BillingDisabledError",
    );
    // No plan is sold or changed.
    await assert.rejects(
      stripeSubscriptions.getPlanCustomerId("store"),
      (error: Error) => error.name === "BillingDisabledError",
    );
    await assert.rejects(
      stripeSubscriptions.createSubscriptionCheckoutSession({
        storeId: "store",
        planSlug: "pro",
        interval: "monthly",
        currency: "eur",
        successUrl: "https://app.test/ok",
        cancelUrl: "https://app.test/cancel",
      }),
      (error: Error) => error.name === "BillingDisabledError",
    );
    await assert.rejects(
      stripeSubscriptions.changeSubscriptionPlan("store", "pro", "monthly", "eur"),
      (error: Error) => error.name === "BillingDisabledError",
    );
    // A query would fail on the closed port: these answer without one.
    assert.equal(await stripeSubscriptions.hasStripeCustomer("store"), false);
    assert.equal(await stripeSubscriptions.storeHasDefaultPaymentMethod("store"), false);
    assert.deepEqual(await stripeSubscriptions.getOffSessionCustomer("store"), {
      ok: false,
      reason: "no_customer",
    });
  });

  test("SMS have no Louez quota and AI credits and number rental are off", async () => {
    assert.equal(await planLimits.determineSmsSource("store"), "plan");
    assert.equal(plans.areAiCreditsEnabled(), false);
    assert.equal(numberBilling.isNumberRentalEnabled(), false);

    process.env.LOUEZ_BILLING = "cloud";
    assert.equal(plans.areAiCreditsEnabled(), true);
    assert.equal(numberBilling.isNumberRentalEnabled(), true);
  });

  test("every store gets the unlimited plan, with no plan limit and the chat open", async () => {
    const plan = await planLimits.getStorePlan("store");
    assert.equal(plan.slug, "pay_as_you_go");
    assert.equal(plan.features.maxProducts, null);
    assert.equal(plan.features.maxReservationsPerMonth, null);
    assert.equal(plan.features.maxCollaborators, null);
    assert.equal(plan.features.aiAdvisor, true);
    assert.equal(await stripeSubscriptions.getCurrentPlanSlug("store"), "pay_as_you_go");
    assert.deepEqual(await multiStore.getStoresApproachingLimits(["store"]), []);
    // The operator pays its own AI provider: abuse limits only, never an upgrade prompt.
    assert.deepEqual(await rateLimit.resolveChatLimits("store"), rateLimit.SELF_HOSTED_LIMITS);
  });

  // The platform webhook's 404 is checked by the Docker smoke test (docker.yml): its
  // route loads the storage SDK, which does not load under node:test.
  test("referral invitations and billing pages are absent", async () => {
    assert.equal(await referralInvite.getReferralInviteContext(), null);

    assert.throws(
      () => requireBilling.requirePlatformBilling(),
      (error: unknown) =>
        error instanceof Error && String(Reflect.get(error, "digest")).endsWith(";404"),
    );
    await assert.rejects(
      requireBilling.requireLegacyBilling("store"),
      (error: unknown) =>
        error instanceof Error && String(Reflect.get(error, "digest")).endsWith(";404"),
    );
    process.env.LOUEZ_BILLING = "cloud";
    assert.doesNotThrow(() => requireBilling.requirePlatformBilling());
  });

  test("Stripe Connect needs its key and webhook secret, not the plan prices", () => {
    assert.equal(stripeClient.isConnectConfigured(), true);
    const key = { STRIPE_SECRET_KEY: "sk_test_billing_off" };
    const secret = { STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect_billing_off" };
    assert.equal(stripeClient.isConnectConfigured({ ...key, ...secret }), true);
    // Without the Connect webhook secret, no payment would ever be confirmed.
    assert.equal(
      stripeClient.isConnectConfigured({ ...key, STRIPE_CONNECT_WEBHOOK_SECRET: undefined }),
      false,
    );
    assert.equal(
      stripeClient.isConnectConfigured({ ...key, STRIPE_CONNECT_WEBHOOK_SECRET: "" }),
      false,
    );
    assert.equal(
      stripeClient.isConnectConfigured({ STRIPE_SECRET_KEY: undefined, ...secret }),
      false,
    );
  });

  test("with billing on, the same paths do reach the database", async () => {
    process.env.LOUEZ_BILLING = "cloud";
    const { executor, calls } = spyDatabase();

    await assert.rejects(lock.ensureSubscriptionRow(executor, "store"), /database touched/);
    assert.ok(calls.length > 0);
    await assert.rejects(
      metering.planStripeFees({ storeId: "store", reservationId: "r", chargeCents: 10_000 }),
      /ECONNREFUSED|Failed query/,
    );
    // The status read before the record, then the void. The log names the
    // driver's reason, not only drizzle's failed query.
    const effectErrors = await runFeeEffects();
    assert.equal(effectErrors.length, 2);
    for (const error of effectErrors) assert.match(error, /ECONNREFUSED/);
    await assert.rejects(
      legacyFeeRepair.reportLegacyFees(new Date("2026-03-02T04:45:00Z")),
      /ECONNREFUSED|Failed query/,
    );
    // Plans and chat limits come from the store's subscription row again.
    await assert.rejects(planLimits.getStorePlan("store"), /ECONNREFUSED|Failed query/);
    await assert.rejects(rateLimit.resolveChatLimits("store"), /ECONNREFUSED|Failed query/);
  });
});
