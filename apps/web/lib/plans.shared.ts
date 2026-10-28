import type { PlanFeatures } from "@louez/types";

export type Currency = "eur" | "usd";

export const SUPPORTED_CURRENCIES: Currency[] = ["eur", "usd"];

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  eur: "€",
  usd: "$",
};

export interface PlanPrices {
  monthly?: string;
  yearly?: string;
}

export interface Plan {
  slug: string;
  name: string;
  description: string;
  // Monthly price, identical in EUR and USD.
  price: number;
  features: PlanFeatures;
  isPopular?: boolean;
  // Legacy EUR fields kept for backwards compatibility.
  stripePriceMonthly?: string;
  stripePriceYearly?: string;
  // Multi-currency prices.
  stripePrices?: Record<Currency, PlanPrices>;
}

type PlanPriceConfig = Pick<Plan, "stripePriceMonthly" | "stripePriceYearly" | "stripePrices">;

export function getPlanPriceId(
  plan: PlanPriceConfig,
  interval: "monthly" | "yearly",
  currency: Currency = "eur",
): string | undefined {
  if (plan.stripePrices?.[currency]) {
    return interval === "monthly"
      ? plan.stripePrices[currency].monthly
      : plan.stripePrices[currency].yearly;
  }
  if (currency === "eur") {
    return interval === "monthly" ? plan.stripePriceMonthly : plan.stripePriceYearly;
  }
  return undefined;
}

/**
 * The plan, interval and currency a Stripe price bills (getPlanPriceId read backwards),
 * or null for a price no plan has.
 */
export function findPlanPrice<P extends PlanPriceConfig & Pick<Plan, "slug">>(
  plans: readonly P[],
  priceId: string,
): { plan: P; interval: "monthly" | "yearly"; currency: Currency } | null {
  for (const plan of plans) {
    for (const currency of SUPPORTED_CURRENCIES) {
      for (const interval of ["monthly", "yearly"] as const) {
        if (getPlanPriceId(plan, interval, currency) === priceId) return { plan, interval, currency };
      }
    }
  }
  return null;
}

export function isPlanAvailable(
  plan: PlanPriceConfig,
  interval: "monthly" | "yearly",
  currency: Currency = "eur",
): boolean {
  return Boolean(getPlanPriceId(plan, interval, currency));
}

export function getYearlyPrice(plan: Pick<Plan, "price">): number {
  return plan.price * 10;
}

export function formatPlanPrice(price: number, currency: Currency = "eur"): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  if (currency === "eur") {
    return `${price}${symbol}`;
  }
  return `${symbol}${price}`;
}
