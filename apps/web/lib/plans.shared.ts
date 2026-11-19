import type { PlanFeatures } from "@louez/types";

/**
 * The currencies a plan can be billed in (docs/billing/devise-abonnement.md). A store is
 * billed in its own currency once every paid plan has its four Stripe prices in it
 * (lib/plans.ts); otherwise in EUR, the first one.
 */
export const PLAN_CURRENCIES = ["eur", "usd", "gbp", "chf", "cad"] as const;

export type Currency = (typeof PLAN_CURRENCIES)[number];

/** The currency a store falls back to when its own has no plan prices. */
export const DEFAULT_PLAN_CURRENCY: Currency = "eur";

/**
 * The currencies whose plan amounts are the code's `price` (1:1 with EUR, as the website
 * shows them). Any other one shows the amounts of its Stripe prices (lib/billing/plan-pricing.ts).
 */
export const CODE_PRICED_CURRENCIES: readonly Currency[] = ["eur", "usd"];

export const isPlanCurrency = (value: string): value is Currency =>
  PLAN_CURRENCIES.some((currency) => currency === value);

export interface PlanPrices {
  monthly?: string;
  yearly?: string;
}

export interface Plan {
  slug: string;
  name: string;
  description: string;
  // Monthly price in EUR and USD (CODE_PRICED_CURRENCIES).
  price: number;
  features: PlanFeatures;
  isPopular?: boolean;
  // Legacy EUR fields kept for backwards compatibility.
  stripePriceMonthly?: string;
  stripePriceYearly?: string;
  // Multi-currency prices.
  stripePrices?: Partial<Record<Currency, PlanPrices>>;
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
  const prices = plan.stripePrices?.[currency];
  if (prices) {
    return interval === "monthly" ? prices.monthly : prices.yearly;
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
    for (const currency of PLAN_CURRENCIES) {
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

/** Whether every paid plan has both its Stripe prices in `currency`. */
export function hasPlanPrices(
  plans: readonly (PlanPriceConfig & Pick<Plan, "price">)[],
  currency: Currency,
): boolean {
  const paid = plans.filter((plan) => plan.price > 0);
  return (
    paid.length > 0 &&
    paid.every(
      (plan) => isPlanAvailable(plan, "monthly", currency) && isPlanAvailable(plan, "yearly", currency),
    )
  );
}

/**
 * The currency a store's plan is bought in: its own (any case), when every paid plan has
 * its prices in it, EUR otherwise, as before stores were billed in their currency.
 */
export function planCurrencyFor(
  plans: readonly (PlanPriceConfig & Pick<Plan, "price">)[],
  storeCurrency: string | null | undefined,
): Currency {
  const code = (storeCurrency ?? "").trim().toLowerCase();
  return isPlanCurrency(code) && hasPlanPrices(plans, code) ? code : DEFAULT_PLAN_CURRENCY;
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

/** The amounts of plans priced by the code (CODE_PRICED_CURRENCIES), for `currency`. */
export function codePlanPricing(
  plans: readonly (PlanPriceConfig & Pick<Plan, "price" | "slug">)[],
  currency: Currency,
): PlanPricing {
  const amounts: PlanPricing["amounts"] = {};
  for (const plan of plans) {
    if (plan.price > 0) amounts[plan.slug] = { monthly: plan.price, yearly: getYearlyPrice(plan) };
  }
  return { currency, amounts };
}

/**
 * A plan price as the plan page writes it: `49€` and `$49` as always for EUR and USD, the
 * locale's currency format otherwise (`£39`, `CA$69`), with cents only when there are some.
 */
export function formatPlanPrice(price: number, currency: Currency = "eur", locale = "en"): string {
  if (currency === "eur") return `${price}€`;
  if (currency === "usd") return `$${price}`;
  const whole = Number.isInteger(price);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(price);
}
