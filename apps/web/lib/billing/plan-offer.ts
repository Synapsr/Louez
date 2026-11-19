import { and, count, eq, gte, inArray, lt, notInArray } from "drizzle-orm";

import {
  customers,
  db,
  platformFees,
  products,
  reservations,
  storeMembers,
  stores,
  subscriptions,
} from "@louez/db";
import type { PlanOfferView } from "@louez/api/contracts/billing";
import { currencyMinorDigits } from "@louez/utils";

import { env } from "@/env";
import { parseAffiliateReferral } from "@/lib/acquisition/klibon";
import { getPlanPricing } from "@/lib/billing/plan-pricing";
import { getEffectivePolicy, type EffectivePolicy } from "@/lib/billing/policy";
import { isBillingEnabled } from "@/lib/billing/mode";
import { getBillingStatement, getBillingStatements } from "@/lib/billing-sync/pages";
import { log } from "@/lib/evlog";
import { priceForLocationIndex } from "@/lib/pay-as-you-go/config";
import {
  ACTIVE_FEE_STATUSES,
  getStoreBilling,
  getStoreCurrency,
} from "@/lib/pay-as-you-go/metering";
import { planInForce } from "@/lib/plan-limits";
import { getPlanPriceId, getPlans, isPlanCurrency, type Currency } from "@/lib/plans";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import {
  createSubscriptionCheckoutSession,
  SubscriptionPlanError,
} from "@/lib/stripe/subscriptions";
import { planCheckoutReturnUrls } from "@/lib/stripe/plan-checkout-urls";

import {
  decidePlanOffer,
  isPlanOfferDismissed,
  planOfferMonths,
  type PlanOffer,
  type PlanOfferCandidate,
  type PlanOfferPeriod,
  type PlanOfferPeriodCost,
  type PlanOfferSource,
  type PlanOfferUsage,
} from "./plan-offer-core";

// The facts of the dashboard's plan offer (docs/domain/plan-offer.md): who may get one,
// what the store paid Louez each month at its own tariff, and the plans it can buy.
// The rule itself is plan-offer-core.ts.

type Months = { readonly current: string; readonly previous: string };

const monthStart = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
const nextMonthStart = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));

/**
 * Who bills the store's pay-as-you-go under `policy`: Louez's legacy code, the billing
 * service with a fee to avoid (a commission or a fee per reservation), or nobody a plan
 * would save anything from (null): a free policy, or a store nobody bills.
 */
function sourceOf(policy: EffectivePolicy): PlanOfferSource | null {
  if (policy.legacyBillingApplies) return "legacy";
  if (policy.terms.invoicing !== "service") return null;
  const fee = policy.terms.applicationFee;
  if (fee.kind === "percent" && fee.rateBps > 0) return "service";
  if (fee.kind === "per_reservation" && fee.amountMinor > 0) return "service";
  return null;
}

const isOfferedSlug = (slug: string): slug is PlanOfferCandidate["slug"] =>
  slug === "pro" || slug === "ultra";

/**
 * What a month's figures depend on: who bills the store and, for the billing service,
 * its fee terms. Two policies with the same key ask the same for the same booking.
 */
function termsKey(policy: EffectivePolicy): string {
  const source = sourceOf(policy);
  return source === "service"
    ? `service:${JSON.stringify(policy.terms.applicationFee)}`
    : String(source);
}

/**
 * The plans the store can buy on Checkout in `currency`, monthly, at the amount its plan
 * page shows (getPlanPricing). None when the currency's prices cannot sell a plan, as the
 * plan page then sells in EUR, which the store's fees are not in.
 */
async function offerablePlans(currency: Currency): Promise<PlanOfferCandidate[]> {
  const plans = getPlans();
  const pricing = await getPlanPricing(currency, plans);
  if (!pricing) return [];
  const perUnit = 10 ** (currencyMinorDigits(currency) ?? 2);
  return plans.flatMap((plan) => {
    const { slug, features } = plan;
    const amounts = pricing.amounts[slug];
    if (!isOfferedSlug(slug) || !amounts || !getPlanPriceId(plan, "monthly", currency)) return [];
    return [
      {
        slug,
        monthlyPriceMinor: Math.round(amounts.monthly * perUnit),
        limits: {
          products: features.maxProducts,
          reservationsPerMonth: features.maxReservationsPerMonth,
          customers: features.maxCustomers,
          collaborators: features.maxCollaborators,
        },
      },
    ];
  });
}

/** A month's reservations as a plan's monthly limit counts them (lib/plan-limits.ts), in UTC. */
async function countReservations(storeId: string, month: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        gte(reservations.createdAt, monthStart(month)),
        lt(reservations.createdAt, nextMonthStart(month)),
        notInArray(reservations.status, ["cancelled", "rejected"]),
      ),
    );
  return row?.value ?? 0;
}

/** What the store holds now, as Pro's limits count it, and each month's reservations. */
async function readUsage(storeId: string, months: Months) {
  const counted = (rows: { value: number }[]) => rows[0]?.value ?? 0;
  const [productCount, customerCount, collaboratorCount, current, previous] = await Promise.all([
    db
      .select({ value: count() })
      .from(products)
      .where(and(eq(products.storeId, storeId), notInArray(products.status, ["archived"])))
      .then(counted),
    db
      .select({ value: count() })
      .from(customers)
      .where(eq(customers.storeId, storeId))
      .then(counted),
    db
      .select({ value: count() })
      .from(storeMembers)
      .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.role, "member")))
      .then(counted),
    countReservations(storeId, months.current),
    countReservations(storeId, months.previous),
  ]);
  const standing: PlanOfferUsage = {
    products: productCount,
    customers: customerCount,
    collaborators: collaboratorCount,
    reservationsThisMonth: current,
  };
  return { standing, reservations: { current, previous } };
}

/**
 * What a store Louez's legacy code bills paid it each month: its per-reservation fees
 * as recorded, less what a refund gave back, and never more than its tariff of today
 * would ask for the same position in the month, so a tariff lowered since (a launch
 * offer, a free one) is what counts. Free reservations cost nothing, and the
 * marketplace fee is left out since a plan pays it too.
 */
async function legacyPaid(storeId: string, currency: string, months: readonly string[]) {
  const [rows, billing] = await Promise.all([
    db
      .select({
        month: platformFees.billingMonth,
        amountCents: platformFees.amountCents,
        reversedCents: platformFees.amountReversedCents,
        monthlyIndex: platformFees.monthlyIndex,
      })
      .from(platformFees)
      .where(
        and(
          eq(platformFees.storeId, storeId),
          eq(platformFees.currency, currency),
          inArray(platformFees.billingMonth, [...months]),
          inArray(platformFees.status, [...ACTIVE_FEE_STATUSES]),
          inArray(platformFees.source, ["online", "manual"]),
        ),
      ),
    getStoreBilling(storeId),
  ]);
  const paid = new Map<string, number>();
  for (const row of rows) {
    const recorded = Math.max(0, row.amountCents - row.reversedCents);
    const today =
      row.monthlyIndex === null
        ? recorded
        : priceForLocationIndex(billing.config, row.monthlyIndex);
    paid.set(row.month, (paid.get(row.month) ?? 0) + Math.min(recorded, today));
  }
  return (month: string) => paid.get(month) ?? 0;
}

/** The statement groups a plan would have saved: commissions, commission on unpaid totals, fees per reservation. */
const AVOIDABLE_GROUPS = new Set(["commission", "unpaid", "reservations"]);

/**
 * What a store the billing service bills owed it each month: the lines of its statement
 * a plan would have saved (`AVOIDABLE_GROUPS`), the marketplace fees left out since a
 * plan pays them too, and the lines that settle an earlier month (`adjustsPeriod`) left
 * out, so a catch-up never reads as a month's cost. Null when the service cannot tell
 * now: no offer then.
 */
async function servicePaid(storeId: string, currency: string, months: readonly string[]) {
  const list = await getBillingStatements(storeId);
  if (!list.ok) {
    if (list.reason !== "store_unknown") {
      log.warn("billing", `plan offer: statements of ${storeId}: ${list.reason}`);
    }
    return null;
  }
  const paid = new Map<string, number>();
  for (const month of months) {
    const summary = list.value.statements.find(
      (statement) =>
        statement.period === month && statement.currency.toLowerCase() === currency.toLowerCase(),
    );
    if (!summary) continue;
    const statement = await getBillingStatement(storeId, summary.id);
    if (!statement.ok) {
      log.warn("billing", `plan offer: statement ${summary.id} of ${storeId}: ${statement.reason}`);
      return null;
    }
    let total = 0;
    for (const group of statement.value.groups) {
      if (!AVOIDABLE_GROUPS.has(group.group)) continue;
      for (const line of group.lines) if (line.adjustsPeriod === null) total += line.amountMinor;
    }
    paid.set(month, total);
  }
  return (month: string) => paid.get(month) ?? 0;
}

export type PlanOfferEvaluation =
  | { readonly offer: PlanOffer; readonly exclusion: null }
  | {
      readonly offer: null;
      readonly exclusion:
        | "billing_off"
        | "unknown_store"
        | "plan_in_force"
        | "not_pay_as_you_go"
        | "admin_discount"
        | "dismissed"
        | "nothing_to_save"
        | "currency"
        | "unreadable"
        | "no_saving";
    };

/**
 * The offer a store gets at `now`, or why it gets none. `ignoreDismissal`: the owner's
 * e-mail goes out whether the card was closed or not.
 *
 * A month counts only when the same code billed it as bills the store now: its
 * figures are then at the store's tariff of today. A store on a plan, set to
 * subscription billing by the platform, or with an admin coupon or discount gets none.
 */
export async function evaluatePlanOffer(
  storeId: string,
  now: Date,
  options: { ignoreDismissal?: boolean } = {},
): Promise<PlanOfferEvaluation> {
  type Reason = Extract<PlanOfferEvaluation, { offer: null }>["exclusion"];
  const none = (exclusion: Reason): PlanOfferEvaluation => ({ offer: null, exclusion });
  if (!isBillingEnabled()) return none("billing_off");

  const months = planOfferMonths(now);
  const currentStart = monthStart(months.current);
  const [
    store,
    row,
    policyNow,
    policyCurrentStart,
    policyPreviousEnd,
    policyPreviousStart,
    rawCurrency,
  ] = await Promise.all([
    db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: {
        settings: true,
        stripeCouponId: true,
        discountPercent: true,
        planOfferDismissedAt: true,
      },
    }),
    db.query.subscriptions.findFirst({
      where: eq(subscriptions.storeId, storeId),
      columns: { billingMode: true, planSlug: true, status: true, stripeSubscriptionId: true },
    }),
    getEffectivePolicy(storeId, now),
    // Who billed each month, and on which terms, at its first and last instants.
    getEffectivePolicy(storeId, currentStart),
    getEffectivePolicy(storeId, new Date(currentStart.getTime() - 1)),
    getEffectivePolicy(storeId, monthStart(months.previous)),
    getStoreCurrency(storeId),
  ]);
  if (!store) return none("unknown_store");
  // A store with no row is on pay-as-you-go: the new stores the service bills have none.
  if (planInForce(row)) return none("plan_in_force");
  if (row && row.billingMode !== "pay_as_you_go") return none("not_pay_as_you_go");
  if (store.stripeCouponId || store.discountPercent > 0) return none("admin_discount");
  if (!options.ignoreDismissal && isPlanOfferDismissed(store.planOfferDismissedAt, now)) {
    return none("dismissed");
  }
  const source = sourceOf(policyNow);
  if (!source) return none("nothing_to_save");

  const currency = rawCurrency.toLowerCase();
  if (!isPlanCurrency(currency)) return none("currency");
  const plans = await offerablePlans(currency);
  if (plans.length === 0) return none("currency");

  // A month counts only when it was billed as the store is billed now, from its start to
  // its end: then what it paid is what today's tariff asks. Louez's legacy fees are also
  // capped at today's tariff, row by row (legacyPaid).
  const billedAsNow = (...policies: EffectivePolicy[]) =>
    policies.every((policy) => termsKey(policy) === termsKey(policyNow));
  const counted: [PlanOfferPeriod, string][] = [];
  if (billedAsNow(policyCurrentStart)) counted.push(["current", months.current]);
  if (billedAsNow(policyPreviousStart, policyPreviousEnd))
    counted.push(["previous", months.previous]);
  if (counted.length === 0) return none("no_saving");

  const [paidOf, usage] = await Promise.all([
    source === "service"
      ? servicePaid(
          storeId,
          currency,
          counted.map(([, month]) => month),
        )
      : legacyPaid(
          storeId,
          currency,
          counted.map(([, month]) => month),
        ),
    readUsage(storeId, months),
  ]);
  if (!paidOf) return none("unreadable");

  const costs: PlanOfferPeriodCost[] = counted.map(([period, month]) => ({
    period,
    month,
    paidMinor: paidOf(month),
    reservations: usage.reservations[period],
  }));
  const offer = decidePlanOffer({
    source,
    currency,
    country: store.settings?.country ?? null,
    plans,
    standing: usage.standing,
    costs,
  });
  return offer ? { offer, exclusion: null } : none("no_saving");
}

/** The analytics properties of an offer, with its amounts in minor units. */
export function planOfferProperties(storeId: string, offer: PlanOfferView) {
  return {
    feature: "plan_offer",
    surface: "dashboard",
    store_id: storeId,
    plan: offer.plan,
    billing_source: offer.source,
    period: offer.period,
    month: offer.month,
    currency: offer.currency,
    paid_cents: offer.paidMinor,
    plan_price_cents: offer.planPriceMinor,
    threshold_cents: offer.thresholdMinor,
    savings_cents: offer.savingsMinor,
    vat_rate_bps: offer.vatRateBps,
  };
}

/** The offer the store's home shows now, or null. */
export async function readPlanOffer(input: {
  storeId: string;
  now: Date;
}): Promise<PlanOfferView | null> {
  return (await evaluatePlanOffer(input.storeId, input.now)).offer;
}

/**
 * Counts the card as seen by `userId`, with the figures it showed: the dashboard reports
 * it once the card is on screen. Best effort, never fails the call.
 */
export async function recordPlanOfferShown(input: {
  storeId: string;
  userId: string;
  offer: PlanOfferView;
}): Promise<void> {
  // Loaded here: the analytics client is server-only, and the billing port that
  // imports this module is also read by scripts and tests outside Next.
  const { captureProductServerEvent } = await import("@/lib/product-analytics/analytics");
  await captureProductServerEvent({
    distinctId: input.userId,
    event: productAnalyticsEvents.planOfferShown,
    properties: planOfferProperties(input.storeId, input.offer),
  });
}

/**
 * The offered plan's Checkout, monthly, without a trial: the store knows Louez already
 * and the plan is monthly with no commitment. Opened only while the offer applies: no
 * plan in force, no admin coupon (so Checkout keeps its promotion code field). Null
 * when the offer no longer applies, or the store holds a live subscription.
 */
export async function startPlanOfferCheckout(input: {
  storeId: string;
  affiliateReferral: string | null;
  now: Date;
}): Promise<{ url: string; offer: PlanOfferView } | null> {
  const { offer } = await evaluatePlanOffer(input.storeId, input.now, { ignoreDismissal: true });
  if (!offer || !isPlanCurrency(offer.currency)) return null;
  const currency = offer.currency;
  try {
    const session = await createSubscriptionCheckoutSession({
      storeId: input.storeId,
      planSlug: offer.plan,
      interval: "monthly",
      currency,
      trialDays: 0,
      stripeCouponId: undefined,
      ...planCheckoutReturnUrls(env.NEXT_PUBLIC_APP_URL),
      affiliateReferral: parseAffiliateReferral(input.affiliateReferral),
    });
    if (!session.url) throw new Error("Stripe gave the plan Checkout no URL.");
    return { url: session.url, offer };
  } catch (error) {
    if (error instanceof SubscriptionPlanError) return null;
    throw error;
  }
}
