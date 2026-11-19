import { currencyMinorDigits } from "@louez/utils";

import {
  CODE_PRICED_CURRENCIES,
  getPlanPriceId,
  type Currency,
  type Plan,
  type PlanPricing,
  codePlanPricing,
} from "@/lib/plans.shared";

// The prices a store's plans are shown and sold in (docs/billing/devise-abonnement.md),
// without Stripe: lib/billing/plan-pricing.ts reads the prices and caches them.

/** What the plan page needs to know of a Stripe price. */
export interface PlanStripePrice {
  readonly id: string;
  readonly active: boolean;
  readonly currency: string;
  /** Minor units; null for a price Stripe computes (tiers, a custom amount). */
  readonly unitAmount: number | null;
  readonly recurringInterval: string | null;
}

/** Why a currency's prices cannot sell a plan; null when they all can. */
export type PlanPriceProblem =
  | { readonly kind: "missing"; readonly priceId: string }
  | { readonly kind: "mismatch"; readonly priceId: string; readonly field: string };

type PricedPlan = Pick<Plan, "slug" | "price" | "stripePriceMonthly" | "stripePriceYearly" | "stripePrices">;

const STRIPE_INTERVAL = { monthly: "month", yearly: "year" } as const;

/** The price ids a currency's paid plans need, monthly and yearly. */
export function planPriceIds(plans: readonly PricedPlan[], currency: Currency): string[] {
  return plans.flatMap((plan) =>
    plan.price > 0
      ? (["monthly", "yearly"] as const).flatMap((interval) => {
          const id = getPlanPriceId(plan, interval, currency);
          return id ? [id] : [];
        })
      : [],
  );
}

/**
 * The amounts of every paid plan in `currency`, from its Stripe prices, or the first
 * problem that keeps them from selling: a price Stripe does not have, or one that bills
 * another currency, another interval, no fixed amount, or is archived. A currency the
 * code prices (EUR, USD) takes the code's amounts, as the plan page always showed them.
 */
export function planPricingFromStripe(
  plans: readonly PricedPlan[],
  currency: Currency,
  prices: ReadonlyMap<string, PlanStripePrice>,
): { pricing: PlanPricing; problem: null } | { pricing: null; problem: PlanPriceProblem } {
  if (CODE_PRICED_CURRENCIES.includes(currency)) {
    return { pricing: codePlanPricing(plans, currency), problem: null };
  }
  const digits = currencyMinorDigits(currency) ?? 2;
  const amounts: PlanPricing["amounts"] = {};
  for (const plan of plans) {
    if (plan.price <= 0) continue;
    const pair = { monthly: 0, yearly: 0 };
    for (const interval of ["monthly", "yearly"] as const) {
      const priceId = getPlanPriceId(plan, interval, currency);
      if (!priceId) return { pricing: null, problem: { kind: "missing", priceId: `${plan.slug} ${interval}` } };
      const price = prices.get(priceId);
      if (!price) return { pricing: null, problem: { kind: "missing", priceId } };
      const mismatch = (field: string) => ({
        pricing: null,
        problem: { kind: "mismatch", priceId, field } as const,
      });
      if (!price.active) return mismatch("active");
      if (price.currency.toLowerCase() !== currency) return mismatch("currency");
      if (price.recurringInterval !== STRIPE_INTERVAL[interval]) return mismatch("interval");
      if (price.unitAmount === null) return mismatch("unit_amount");
      pair[interval] = price.unitAmount / 10 ** digits;
    }
    amounts[plan.slug] = pair;
  }
  return { pricing: { currency, amounts }, problem: null };
}
