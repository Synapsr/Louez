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

/**
 * Pseudo-plan for pay-as-you-go stores. Not purchasable as a subscription — it is
 * returned by `getStorePlan` when a store's billing mode is `pay_as_you_go`. PAYG
 * stores pay per rental, so every limit is unlimited and every feature is unlocked.
 * Exception: pay-as-you-go includes NO free SMS — unlike Pro/Ultra which bundle a
 * monthly allowance, PAYG stores pay for every SMS (via top-up credits).
 */
export const PAY_AS_YOU_GO_PLAN: Plan = {
  slug: "pay_as_you_go",
  name: "Pay as you go",
  description: "Facturation à la location",
  price: 0,
  features: {
    maxProducts: null,
    maxReservationsPerMonth: null,
    maxCustomers: null,
    maxCollaborators: null,
    maxSmsPerMonth: 0,
    aiCreditsPerMonth: 0, // PAYG: no monthly allowance, prepaid credits only
    onlinePayment: true,
    analytics: true,
    emailNotifications: true,
    whiteLabel: true,
    customDomain: true,
    prioritySupport: true,
    customerPortal: true,
    reviewBooster: true,
    aiAdvisor: true,
    aiPhone: true,
    apiAccess: true,
    phoneSupport: true,
    dedicatedManager: false,
  },
};

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
        if (getPlanPriceId(plan, interval, currency) === priceId)
          return { plan, interval, currency };
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
