import type { PlanFeatures } from "@louez/types";

/**
 * A currency, as Stripe writes it: ISO 4217, lower case (`eur`, `gbp`). A plan is sold in
 * any currency its Stripe prices have (docs/billing/devise-abonnement.md).
 */
export type Currency = string;

/** The currency a store falls back to when the plans' prices lack its own. */
export const DEFAULT_PLAN_CURRENCY: Currency = "eur";

export interface PlanPrices {
  monthly?: string;
  yearly?: string;
}

export interface Plan {
  slug: string;
  name: string;
  description: string;
  // Monthly price in EUR, shown when Stripe cannot be read.
  price: number;
  features: PlanFeatures;
  isPopular?: boolean;
  /**
   * The plan's Stripe prices: one per interval, in EUR, with an amount per other currency
   * (Stripe's `currency_options`).
   */
  stripePrices?: PlanPrices;
  /**
   * Earlier single-currency prices, by currency: they still bill the subscriptions bought
   * on them, and sell in a currency `stripePrices` lacks.
   */
  legacyStripePrices?: Record<Currency, PlanPrices>;
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

type PlanPriceConfig = Pick<Plan, "stripePrices" | "legacyStripePrices">;

/**
 * The plan and interval a Stripe price bills, the plan's own or one of its earlier prices,
 * or null for a price no plan has.
 */
export function findPlanPrice<P extends PlanPriceConfig & Pick<Plan, "slug">>(
  plans: readonly P[],
  priceId: string,
): { plan: P; interval: "monthly" | "yearly" } | null {
  for (const plan of plans) {
    const sets = [plan.stripePrices, ...Object.values(plan.legacyStripePrices ?? {})];
    for (const prices of sets) {
      for (const interval of ["monthly", "yearly"] as const) {
        if (prices?.[interval] === priceId) return { plan, interval };
      }
    }
  }
  return null;
}

export function getYearlyPrice(plan: Pick<Plan, "price">): number {
  return plan.price * 10;
}

/** A plan's amounts in one currency, in major units (49 for 49 €), excluding VAT. */
export interface PlanAmounts {
  monthly: number;
  yearly: number;
}

/**
 * The prices the plan page shows and sells: one currency, and the amounts of each plan
 * slug in it. A plan without amounts cannot be bought in that currency.
 */
export interface PlanPricing {
  currency: Currency;
  amounts: Partial<Record<string, PlanAmounts>>;
}

/** The plans' EUR amounts as the code knows them, for when Stripe cannot be read. */
export function codePlanPricing(plans: readonly Pick<Plan, "price" | "slug">[]): PlanPricing {
  const amounts: PlanPricing["amounts"] = {};
  for (const plan of plans) {
    if (plan.price > 0) amounts[plan.slug] = { monthly: plan.price, yearly: getYearlyPrice(plan) };
  }
  return { currency: DEFAULT_PLAN_CURRENCY, amounts };
}

/**
 * A plan price as the plan page writes it: `49€` and `$49` as always for EUR and USD, the
 * locale's currency format otherwise (`£39`, `CA$69`), with cents only when there are some.
 */
export function formatPlanPrice(price: number, currency: Currency = "eur", locale = "en"): string {
  if (currency === "eur") return `${price}€`;
  if (currency === "usd") return `$${price}`;
  const whole = Number.isInteger(price);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(price);
  } catch {
    return `${price} ${currency.toUpperCase()}`;
  }
}
