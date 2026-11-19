import { currencyMinorDigits } from "@louez/utils";

import {
  codePlanPricing,
  DEFAULT_PLAN_CURRENCY,
  type Currency,
  type Plan,
  type PlanAmounts,
  type PlanPrices,
  type PlanPricing,
} from "@/lib/plans.shared";

// The currencies the plans sell in, and at which amounts (docs/billing/devise-abonnement.md),
// without Stripe: lib/billing/plan-pricing.ts reads the prices and caches the catalog.

type Interval = "monthly" | "yearly";

/** What the catalog needs to know of a Stripe price. */
export interface PlanStripePrice {
  readonly id: string;
  readonly active: boolean;
  /** Its default currency. */
  readonly currency: string;
  readonly recurringInterval: string | null;
  /**
   * Its amount in minor units per currency, the default one included (Stripe's
   * `currency_options`); null for an amount Stripe computes (tiers, a custom amount).
   */
  readonly amounts: Readonly<Record<string, number | null>>;
}

/** One currency the plans sell in: each paid plan's amounts and the prices that bill them. */
export interface PlanCatalogEntry {
  readonly pricing: PlanPricing;
  readonly priceIds: Readonly<Record<string, Readonly<Record<Interval, string>>>>;
}

/** The currencies the plans sell in, by lower-case code. */
export type PlanCatalog = ReadonlyMap<Currency, PlanCatalogEntry>;

type PricedPlan = Pick<Plan, "slug" | "price" | "stripePrices" | "legacyStripePrices">;

const STRIPE_INTERVAL: Record<Interval, string> = { monthly: "month", yearly: "year" };
const INTERVALS: readonly Interval[] = ["monthly", "yearly"];

const toMajor = (minor: number, currency: string) =>
  minor / 10 ** (currencyMinorDigits(currency) ?? 2);

/** Every price id the paid plans name, theirs and their earlier ones. */
export function planPriceIds(plans: readonly PricedPlan[]): string[] {
  const ids = new Set<string>();
  for (const plan of plans) {
    if (plan.price <= 0) continue;
    for (const prices of [plan.stripePrices, ...Object.values(plan.legacyStripePrices ?? {})]) {
      for (const interval of INTERVALS) {
        const id = prices?.[interval];
        if (id) ids.add(id);
      }
    }
  }
  return [...ids];
}

/**
 * The currencies a set of prices (one per paid plan and interval) sells in, with their
 * amounts: those in which every price has a fixed amount. Empty when a price is missing,
 * archived or bills another interval; `problems` then says which.
 */
function sellableIn(
  plans: readonly PricedPlan[],
  pricesOf: (plan: PricedPlan) => PlanPrices | undefined,
  prices: ReadonlyMap<string, PlanStripePrice>,
  problems: string[],
): Map<Currency, PlanCatalogEntry> {
  const paid = plans.filter((plan) => plan.price > 0);
  const found: { slug: string; interval: Interval; price: PlanStripePrice }[] = [];
  for (const plan of paid) {
    for (const interval of INTERVALS) {
      const id = pricesOf(plan)?.[interval];
      const price = id ? prices.get(id) : undefined;
      if (!id || !price) {
        problems.push(`${plan.slug} ${interval}: ${id ? `${id} not found` : "no price"}`);
        return new Map();
      }
      if (!price.active || price.recurringInterval !== STRIPE_INTERVAL[interval]) {
        problems.push(`${id}: ${price.active ? `bills every ${price.recurringInterval}` : "archived"}`);
        return new Map();
      }
      found.push({ slug: plan.slug, interval, price });
    }
  }
  const sellable = new Map<Currency, PlanCatalogEntry>();
  if (found.length === 0) return sellable;
  const [first] = found;
  for (const currency of Object.keys(first?.price.amounts ?? {})) {
    const amounts: Record<string, PlanAmounts> = {};
    const priceIds: Record<string, Record<Interval, string>> = {};
    let complete = true;
    for (const { slug, interval, price } of found) {
      const minor = price.amounts[currency];
      if (minor === undefined || minor === null) {
        complete = false;
        break;
      }
      amounts[slug] = { ...(amounts[slug] ?? { monthly: 0, yearly: 0 }), [interval]: toMajor(minor, currency) };
      priceIds[slug] = { ...(priceIds[slug] ?? { monthly: "", yearly: "" }), [interval]: price.id };
    }
    if (complete) sellable.set(currency, { pricing: { currency, amounts }, priceIds });
  }
  return sellable;
}

/**
 * The catalog of `prices`: every currency the plans' own prices have an amount in
 * (`currency_options`), then each earlier single-currency set (USD) for a currency those
 * lack. `problems` lists why a set sells nothing, for the logs.
 */
export function buildPlanCatalog(
  plans: readonly PricedPlan[],
  prices: ReadonlyMap<string, PlanStripePrice>,
): { catalog: PlanCatalog; problems: string[] } {
  const problems: string[] = [];
  const catalog = sellableIn(plans, (plan) => plan.stripePrices, prices, problems);
  const legacyCurrencies = new Set(plans.flatMap((plan) => Object.keys(plan.legacyStripePrices ?? {})));
  for (const currency of legacyCurrencies) {
    if (catalog.has(currency)) continue;
    const legacy = sellableIn(
      plans,
      (plan) => plan.legacyStripePrices?.[currency],
      prices,
      [],
    ).get(currency);
    if (legacy) catalog.set(currency, legacy);
  }
  return { catalog, problems };
}

/**
 * The catalog when Stripe cannot be read: EUR at the code's amounts, on the plans' own
 * prices, so the page still sells as before.
 */
export function fallbackPlanCatalog(plans: readonly PricedPlan[]): PlanCatalog {
  const priceIds: Record<string, Record<Interval, string>> = {};
  for (const plan of plans) {
    const monthly = plan.stripePrices?.monthly;
    const yearly = plan.stripePrices?.yearly;
    if (plan.price > 0 && monthly && yearly) priceIds[plan.slug] = { monthly, yearly };
  }
  const pricing = codePlanPricing(plans.filter((plan) => plan.slug in priceIds));
  return new Map([[DEFAULT_PLAN_CURRENCY, { pricing, priceIds }]]);
}

/**
 * The currency a store buys a plan in: its own (any case) when the catalog sells in it,
 * EUR otherwise, as before stores were billed in their currency.
 */
export function planCurrencyFor(catalog: PlanCatalog, storeCurrency: string | null | undefined): Currency {
  const code = (storeCurrency ?? "").trim().toLowerCase();
  return catalog.has(code) ? code : DEFAULT_PLAN_CURRENCY;
}
