import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import { EU_STANDARD_VAT_BPS, withVatMinor } from "./plan-offer-core";
import {
  type FakeBillingService,
  startFakeBillingService,
  useFakeServiceEnv,
} from "@/lib/billing-sync/fake-billing-service.fixtures";

// The plan offer's facts (docs/domain/plan-offer.md), per kind of store: one Louez's
// legacy code bills per reservation, one the billing service bills on commission (a
// fake), and the owner's one e-mail. Fees use the public test values of fees.md §12
// (Q33), never real ones, and the plans their prices in lib/plans.ts. No Stripe key
// is set, so nothing reaches Stripe.

// The analytics module the offer imports pulls in "server-only".
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    return next(specifier, context);
  },
});

process.env.STRIPE_SECRET_KEY = "";

/** What the offer asked Stripe's plan Checkout for: Stripe itself is never called. */
const checkouts: Record<string, unknown>[] = [];
class SubscriptionPlanError extends Error {}
let liveSubscription = false;
mock.module("@/lib/stripe/subscriptions", {
  namedExports: {
    SubscriptionPlanError,
    createSubscriptionCheckoutSession: async (options: Record<string, unknown>) => {
      if (liveSubscription) throw new SubscriptionPlanError("live_subscription");
      checkouts.push(options);
      return { sessionId: "cs_test", url: "https://checkout.stripe.test/cs_test" };
    },
  },
});
// The queued rows stay in the table, where the test reads them.
mock.module("@/lib/api/effects", { namedExports: { dispatchApiEffects: () => {} } });
process.env.STRIPE_PRICE_PRO_MONTHLY = "price_test_pro_monthly";
process.env.STRIPE_PRICE_ULTRA_MONTHLY = "price_test_ultra_monthly";

/** After the fake's BILLING_NEW_STORES_FROM, 2027-01-25: a store created since is new. */
const NOW = new Date("2027-02-10T09:00:00Z");
const LEGACY = "po_legacy";
const SERVICE = "po_service";
const OWNER = "po_owner";

const percentPolicy = (storeId: string) => ({
  schema: "louez.billing.policy/1",
  storeId,
  version: 1,
  effectiveFrom: "2027-01-25T00:00:00Z",
  issuedAt: "2027-01-24T10:00:00Z",
  newStoresCreatedFrom: null,
  offerKey: "test-commission",
  invoicing: "service",
  currency: "EUR",
  applicationFee: {
    kind: "percent",
    rateBps: 250,
    minMinor: 0,
    maxMinor: null,
    excludeInsurance: false,
    appliesTo: ["rental"],
  },
  marketplaceFeeMinor: 150,
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Commission de test", en: "Test commission" }, notice: null },
});

const line = (
  key: string,
  kind: string,
  amountMinor: number,
  adjustsPeriod: string | null = null,
) => ({
  key,
  kind,
  reservationNumber: null,
  adjustsPeriod,
  amountMinor,
});

/** February's statement: 70 € of commission and unpaid commission, a catch-up and reeent fees aside. */
const FEBRUARY = {
  id: "2027-02-EUR",
  period: "2027-02",
  currency: "EUR",
  status: "open",
  owedMinor: 0,
  atSourceMinor: 0,
  dueMinor: 0,
  groups: [
    {
      group: "commission",
      totalMinor: 0,
      lines: [
        line("pay:p1", "pay", 6000),
        line("refund:r1", "refund", -500),
        // Settles January: not February's cost.
        line("pay:p0", "pay", 4000, "2027-01"),
      ],
    },
    { group: "unpaid", totalMinor: 1500, lines: [line("uncollected:u1", "uncollected", 1500)] },
    { group: "marketplace", totalMinor: 9000, lines: [line("mkt:m1", "mkt", 9000)] },
    { group: "atSource", totalMinor: -6000, lines: [line("fee:f1", "fee", -6000)] },
  ],
};

describe("plan offer (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let offers: typeof import("./plan-offer");
  let emails: typeof import("./plan-offer-email");
  let eq: typeof import("drizzle-orm").eq;
  // Imported once the plans' Stripe prices above are set: the env is read on import.
  let getPlan: typeof import("@/lib/plans").getPlan;

  before(async () => {
    database = await createTestDatabase("plan_offer");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    offers = await import("./plan-offer");
    emails = await import("./plan-offer-email");
    ({ eq } = await import("drizzle-orm"));
    ({ getPlan } = await import("@/lib/plans"));

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@example.test" });
    const store = (id: string, createdAt: string) => ({
      id,
      userId: OWNER,
      name: id,
      slug: id.replaceAll("_", "-"),
      settings: {
        reservationMode: "request" as const,
        advanceNoticeMinutes: 0,
        currency: "EUR",
        country: "FR",
      },
      createdAt: new Date(createdAt),
    });
    await louezDb.db
      .insert(louezDb.stores)
      .values([store(LEGACY, "2026-06-01T00:00:00Z"), store(SERVICE, "2027-02-01T00:00:00Z")]);
    await louezDb.db.insert(louezDb.billingPolicies).values({
      storeId: SERVICE,
      version: 1,
      effectiveFrom: new Date("2027-01-25T00:00:00Z"),
      body: percentPolicy(SERVICE),
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  /** The legacy store's tariff, and its fees of a month: `count` at `priceCents` each. */
  async function legacyMonth(input: {
    tariffCents: number;
    month: string;
    count: number;
    priceCents: number;
    reversedCents?: number;
  }) {
    const { db, platformFees, subscriptions } = louezDb;
    await db.delete(platformFees).where(eq(platformFees.storeId, LEGACY));
    await db.delete(subscriptions).where(eq(subscriptions.storeId, LEGACY));
    await db.insert(subscriptions).values({
      storeId: LEGACY,
      planSlug: "pay_as_you_go",
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: { flatRateCents: input.tariffCents, currency: "eur" },
      freeReservationsGranted: 0,
    });
    const rows = Array.from({ length: input.count }, (_, index) => ({
      storeId: LEGACY,
      reservationId: `po_res_${input.month}_${index}`,
      dedupKey: `res:po_res_${input.month}_${index}`,
      amountCents: input.priceCents,
      amountReversedCents: index === 0 ? (input.reversedCents ?? 0) : 0,
      currency: "eur",
      source: (index % 2 === 0 ? "online" : "manual") as "online" | "manual",
      status: (index % 2 === 0 ? "collected" : "pending") as "collected" | "pending",
      billingMonth: input.month,
      monthlyIndex: index + 1,
    }));
    // A reeent fee the plan would not save.
    rows.push({
      storeId: LEGACY,
      reservationId: `po_mkt_${input.month}`,
      dedupKey: `mkt:po_mkt_${input.month}`,
      amountCents: 150,
      amountReversedCents: 0,
      currency: "eur",
      source: "marketplace_online" as never,
      status: "collected",
      billingMonth: input.month,
      monthlyIndex: null as never,
    });
    await db.insert(platformFees).values(rows);
  }

  beforeEach(async () => {
    const { db, stores } = louezDb;
    await db
      .update(stores)
      .set({
        planOfferDismissedAt: null,
        planOfferNotifiedAt: null,
        stripeCouponId: null,
        discountPercent: 0,
      })
      .where(eq(stores.userId, OWNER));
  });

  test("a legacy store offered Pro: its fees net of refunds, the marketplace fee aside", async () => {
    // 70 reservations at the public test fee, one refunded: just above Pro with French VAT.
    await legacyMonth({
      tariffCents: 90,
      month: "2027-02",
      count: 70,
      priceCents: 90,
      reversedCents: 90,
    });
    const pro = getPlan("pro")!.price * 100;
    const france = EU_STANDARD_VAT_BPS.FR!;
    const threshold = withVatMinor(pro, france);
    const { offer } = await offers.evaluatePlanOffer(LEGACY, NOW);
    assert.deepEqual(offer, {
      plan: "pro",
      source: "legacy",
      period: "current",
      month: "2027-02",
      currency: "eur",
      paidMinor: 69 * 90,
      planPriceMinor: pro,
      vatRateBps: france,
      thresholdMinor: threshold,
      savingsMinor: 69 * 90 - threshold,
    });
  });

  test("a lower tariff needs more reservations, and a tariff lowered since counts as it is now", async () => {
    await legacyMonth({ tariffCents: 50, month: "2027-02", count: 100, priceCents: 50 });
    assert.equal((await offers.evaluatePlanOffer(LEGACY, NOW)).exclusion, "no_saving");

    // Last month's 90 reservations at the higher fee, on a tariff that is lower today.
    await legacyMonth({ tariffCents: 50, month: "2027-01", count: 90, priceCents: 90 });
    assert.equal((await offers.evaluatePlanOffer(LEGACY, NOW)).exclusion, "no_saving");
  });

  test("offers nothing to a store with a coupon, on a plan, or that closed the card", async () => {
    await legacyMonth({ tariffCents: 90, month: "2027-02", count: 80, priceCents: 90 });
    const { db, stores, subscriptions } = louezDb;

    await db.update(stores).set({ stripeCouponId: "coupon_admin" }).where(eq(stores.id, LEGACY));
    assert.equal((await offers.evaluatePlanOffer(LEGACY, NOW)).exclusion, "admin_discount");
    await db.update(stores).set({ stripeCouponId: null }).where(eq(stores.id, LEGACY));

    await db
      .update(stores)
      .set({ planOfferDismissedAt: new Date("2027-02-01T00:00:00Z") })
      .where(eq(stores.id, LEGACY));
    assert.equal((await offers.evaluatePlanOffer(LEGACY, NOW)).exclusion, "dismissed");
    assert.equal(
      (await offers.evaluatePlanOffer(LEGACY, NOW, { ignoreDismissal: true })).offer?.plan,
      "pro",
    );
    await db
      .update(stores)
      .set({ planOfferDismissedAt: new Date("2027-01-05T00:00:00Z") })
      .where(eq(stores.id, LEGACY));
    assert.equal((await offers.evaluatePlanOffer(LEGACY, NOW)).offer?.plan, "pro");

    await db
      .update(subscriptions)
      .set({
        billingMode: "subscription",
        planSlug: "pro",
        status: "trialing",
        stripeSubscriptionId: "sub_test",
      })
      .where(eq(subscriptions.storeId, LEGACY));
    assert.equal((await offers.evaluatePlanOffer(LEGACY, NOW)).exclusion, "plan_in_force");
  });

  test("a store the service bills: the avoidable statement lines of the month", async () => {
    service.handle(`/stores/${SERVICE}/billing/statements`, () => ({
      status: 200,
      body: {
        timeZone: "Europe/Paris",
        legacy: null,
        statements: [{ ...FEBRUARY, groups: undefined }].map(
          ({ groups: _groups, ...summary }) => summary,
        ),
      },
    }));
    service.handle(`/stores/${SERVICE}/billing/statements/2027-02-EUR`, () => ({
      status: 200,
      body: FEBRUARY,
    }));
    const { offer } = await offers.evaluatePlanOffer(SERVICE, NOW);
    // 60 − 5 + 15 €: the catch-up of January and the reeent fees left out.
    assert.equal(offer?.paidMinor, 7000);
    assert.equal(offer?.source, "service");
    assert.equal(offer?.period, "current");
    assert.equal(offer?.plan, "pro");

    service.handle(`/stores/${SERVICE}/billing/statements`, () => ({ status: 503, body: {} }));
    assert.equal((await offers.evaluatePlanOffer(SERVICE, NOW)).exclusion, "unreadable");
  });

  test("the owner is e-mailed once, ever", async () => {
    await legacyMonth({ tariffCents: 90, month: "2027-02", count: 80, priceCents: 90 });
    service.handle(`/stores/${SERVICE}/billing/statements`, () => ({ status: 503, body: {} }));
    const { db, apiEffects, stores } = louezDb;

    const first = await emails.queuePlanOfferEmails(NOW);
    const second = await emails.queuePlanOfferEmails(NOW);
    assert.equal(first.queued, 1);
    assert.equal(second.queued, 0);
    const rows = await db.select().from(apiEffects).where(eq(apiEffects.storeId, LEGACY));
    const queued = rows.filter((row) => row.type === "billing.planOfferEmail");
    assert.equal(queued.length, 1);
    const [row] = queued;
    assert.ok(row);
    assert.equal((row.payload as { offer: { paidMinor: number } }).offer.paidMinor, 80 * 90);
    const [store] = await db
      .select({ notifiedAt: stores.planOfferNotifiedAt })
      .from(stores)
      .where(eq(stores.id, LEGACY));
    assert.ok(store?.notifiedAt);
  });

  test("the button opens the offered plan's Checkout: monthly, no trial, no coupon", async () => {
    await legacyMonth({ tariffCents: 90, month: "2027-02", count: 80, priceCents: 90 });
    checkouts.length = 0;
    const started = await offers.startPlanOfferCheckout({
      storeId: LEGACY,
      affiliateReferral: null,
      now: NOW,
    });
    assert.equal(started?.url, "https://checkout.stripe.test/cs_test");
    assert.equal(started?.offer.plan, "pro");
    assert.equal(checkouts.length, 1);
    const options = checkouts[0]!;
    assert.equal(options.storeId, LEGACY);
    assert.equal(options.planSlug, "pro");
    assert.equal(options.interval, "monthly");
    assert.equal(options.currency, "eur");
    assert.equal(options.trialDays, 0);
    // No coupon: Checkout keeps its promotion code field (allow_promotion_codes).
    assert.equal(options.stripeCouponId, undefined);
    assert.match(String(options.successUrl), /\/dashboard\/settings\/subscription\?success=true$/);

    // A live subscription, or an offer that no longer holds, opens nothing.
    liveSubscription = true;
    assert.equal(
      await offers.startPlanOfferCheckout({ storeId: LEGACY, affiliateReferral: null, now: NOW }),
      null,
    );
    liveSubscription = false;
    await louezDb.db
      .update(louezDb.stores)
      .set({ discountPercent: 50 })
      .where(eq(louezDb.stores.id, LEGACY));
    assert.equal(
      await offers.startPlanOfferCheckout({ storeId: LEGACY, affiliateReferral: null, now: NOW }),
      null,
    );
    assert.equal(checkouts.length, 1);
  });

  test("a month billed on other terms than today's does not count", async () => {
    service.handle(`/stores/${SERVICE}/billing/statements`, () => ({
      status: 200,
      body: {
        timeZone: "Europe/Paris",
        legacy: null,
        statements: [{ ...FEBRUARY, groups: undefined }].map(
          ({ groups: _groups, ...summary }) => summary,
        ),
      },
    }));
    service.handle(`/stores/${SERVICE}/billing/statements/2027-02-EUR`, () => ({
      status: 200,
      body: FEBRUARY,
    }));
    assert.equal((await offers.evaluatePlanOffer(SERVICE, NOW)).offer?.plan, "pro");

    // The rate dropped on 5 February: February's figures are at the old rate.
    const lower = percentPolicy(SERVICE);
    await louezDb.db.insert(louezDb.billingPolicies).values({
      storeId: SERVICE,
      version: 2,
      effectiveFrom: new Date("2027-02-05T00:00:00Z"),
      body: {
        ...lower,
        version: 2,
        effectiveFrom: "2027-02-05T00:00:00Z",
        applicationFee: { ...lower.applicationFee, rateBps: 123 },
      },
    });
    assert.equal((await offers.evaluatePlanOffer(SERVICE, NOW)).exclusion, "no_saving");
  });

  test("the daily run takes every candidate in turn when there are too many", () => {
    const ids = Array.from(
      { length: 1200 },
      (_, index) => `store_${String(index).padStart(4, "0")}`,
    );
    const seen = new Set<string>();
    for (let day = 0; day < 3; day += 1) {
      const batch = emails.rotateDaily(ids, new Date(Date.UTC(2027, 1, 10 + day)));
      assert.equal(batch.length, 500);
      for (const id of batch) seen.add(id);
    }
    assert.equal(seen.size, 1200);
    assert.deepEqual(emails.rotateDaily(["b", "a", "a"], NOW), ["a", "b"]);
  });

  test("nothing at all with billing off", async () => {
    await legacyMonth({ tariffCents: 90, month: "2027-02", count: 80, priceCents: 90 });
    const billing = process.env.LOUEZ_BILLING;
    delete process.env.LOUEZ_BILLING;
    try {
      assert.equal((await offers.evaluatePlanOffer(LEGACY, NOW)).exclusion, "billing_off");
      assert.deepEqual(await emails.queuePlanOfferEmails(NOW), {
        candidates: 0,
        queued: 0,
        failed: 0,
      });
    } finally {
      process.env.LOUEZ_BILLING = billing;
    }
  });
});
