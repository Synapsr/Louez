import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import type { Database, ReservationBillingEffect } from "@louez/db";

// With LOUEZ_BILLING off, the billing paths must return before touching the database.
// DATABASE_URL points at a closed port: any query would fail with ECONNREFUSED. The
// variables are set rather than deleted, because dotenv (loaded by @louez/db) never
// overrides a variable that is already set.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = "mysql://louez:louez@127.0.0.1:1/unreachable";
process.env.LOUEZ_BILLING = "off";
// Credit layers an operator opted into: billing off must still switch them off.
process.env.AI_CREDITS_ENABLED = "true";
process.env.AI_PHONE_NUMBER_RENTAL_CREDITS = "30";

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
  let stripeSubscriptions: typeof import("@/lib/stripe/subscriptions");
  let planLimits: typeof import("@/lib/plan-limits");
  let plans: typeof import("@/lib/plans");
  let numberBilling: typeof import("@/lib/ai/phone/number-billing");
  let reservationEffects: typeof import("@/lib/billing/reservation-effects");
  let legacyFeeRepair: typeof import("./legacy-fee-repair");
  let database: typeof import("@louez/db");

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
    stripeSubscriptions = await import("@/lib/stripe/subscriptions");
    planLimits = await import("@/lib/plan-limits");
    plans = await import("@/lib/plans");
    numberBilling = await import("@/lib/ai/phone/number-billing");
    reservationEffects = await import("@/lib/billing/reservation-effects");
    legacyFeeRepair = await import("./legacy-fee-repair");
    database = await import("@louez/db");
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
    await lock.addFreeReservations(executor, "store", 30);
    await lock.raiseFreeReservations(executor, "store", 30);

    assert.deepEqual(calls, []);
  });

  test("a platform charge is refused before any Stripe or database call", async () => {
    await assert.rejects(
      stripeSubscriptions.getOrCreateStripeCustomer("store"),
      (error: Error) => error.name === "BillingDisabledError",
    );
  });

  test("SMS have no Louez quota and AI credits and number rental are off", async () => {
    assert.equal(await planLimits.determineSmsSource("store"), "plan");
    assert.equal(plans.areAiCreditsEnabled(), false);
    assert.equal(numberBilling.isNumberRentalEnabled(), false);

    process.env.LOUEZ_BILLING = "cloud";
    assert.equal(plans.areAiCreditsEnabled(), true);
    assert.equal(numberBilling.isNumberRentalEnabled(), true);
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
  });
});
