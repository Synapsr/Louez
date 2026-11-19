import type Stripe from "stripe";

import { isStripeNotFound } from "@/lib/billing-sync/gross-backfill-core";
import { log } from "@/lib/evlog";
import {
  getPlans,
  type Currency,
  type Plan,
  type PlanPricing,
} from "@/lib/plans";
import { stripe } from "@/lib/stripe/client";

import {
  buildPlanCatalog,
  fallbackPlanCatalog,
  planCurrencyFor,
  planPriceIds,
  type PlanCatalog,
  type PlanStripePrice,
} from "./plan-pricing-core";

// The currencies and amounts the plans are shown and sold in
// (docs/billing/devise-abonnement.md): the amounts of the plans' Stripe prices, per
// currency (`currency_options`), read once every ten minutes per process. The page never
// shows an amount Stripe would not bill.

const CACHE_MS = 10 * 60 * 1000;

const cache = new Map<string, { readonly at: number; readonly catalog: Promise<PlanCatalog> }>();

function amountsOf(price: Stripe.Price): Record<string, number | null> {
  const amounts: Record<string, number | null> = {};
  for (const [currency, option] of Object.entries(price.currency_options ?? {})) {
    amounts[currency.toLowerCase()] = option.unit_amount ?? null;
  }
  amounts[price.currency.toLowerCase()] = price.unit_amount;
  return amounts;
}

async function readPrice(id: string): Promise<PlanStripePrice | null> {
  try {
    const price = await stripe.prices.retrieve(id, { expand: ["currency_options"] });
    return {
      id: price.id,
      active: price.active,
      currency: price.currency.toLowerCase(),
      recurringInterval: price.recurring?.interval ?? null,
      amounts: amountsOf(price),
    };
  } catch (error) {
    if (isStripeNotFound(error)) return null;
    throw error;
  }
}

async function readCatalog(plans: readonly Plan[]): Promise<PlanCatalog> {
  const prices = new Map<string, PlanStripePrice>();
  for (const price of await Promise.all(planPriceIds(plans).map(readPrice))) {
    if (price) prices.set(price.id, price);
  }
  const { catalog, problems } = buildPlanCatalog(plans, prices);
  if (problems.length > 0) {
    log.warn("billing", `the plans' Stripe prices sell nothing: ${problems.join("; ")}`);
  }
  return catalog;
}

/**
 * The currencies the plans sell in, with their amounts and prices. When Stripe cannot be
 * read, EUR at the code's amounts (fallbackPlanCatalog), not kept, so the next page tries
 * again.
 */
export async function getPlanCatalog(plans: readonly Plan[] = getPlans()): Promise<PlanCatalog> {
  const key = planPriceIds(plans).join(",");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.catalog;

  const catalog = readCatalog(plans).catch((error: unknown) => {
    cache.delete(key);
    log.error(
      "billing",
      `could not read the plans' Stripe prices: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fallbackPlanCatalog(plans);
  });
  cache.set(key, { at: Date.now(), catalog });
  return catalog;
}

/** The plans' amounts in `currency`, or null when they do not sell in it. */
export async function getPlanPricing(currency: Currency): Promise<PlanPricing | null> {
  return (await getPlanCatalog()).get(currency.toLowerCase())?.pricing ?? null;
}

/**
 * The currency and amounts a store buys a plan in: its own currency when the plans sell
 * in it, EUR otherwise, as before.
 */
export async function getStorePlanPricing(storeCurrency: string | null | undefined): Promise<PlanPricing> {
  const catalog = await getPlanCatalog();
  const currency = planCurrencyFor(catalog, storeCurrency);
  return catalog.get(currency)?.pricing ?? { currency, amounts: {} };
}

/** The currency a store's plan Checkout bills (getStorePlanPricing). */
export async function getStorePlanCurrency(storeCurrency: string | null | undefined): Promise<Currency> {
  return planCurrencyFor(await getPlanCatalog(), storeCurrency);
}

/**
 * What the plan page shows: a live subscription's own currency, which Stripe cannot
 * change (no amounts when the plans no longer sell in it), or the store's
 * (getStorePlanPricing).
 */
export async function getPlanPagePricing(input: {
  storeCurrency: string | null | undefined;
  liveCurrency: string | null;
}): Promise<PlanPricing> {
  if (input.liveCurrency) {
    const live = input.liveCurrency.toLowerCase();
    return (await getPlanPricing(live)) ?? { currency: live, amounts: {} };
  }
  return getStorePlanPricing(input.storeCurrency);
}

/** The Stripe price that bills `planSlug` every `interval` in `currency`, or null for none. */
export async function getPlanPriceIn(
  currency: Currency,
  planSlug: string,
  interval: "monthly" | "yearly",
): Promise<string | null> {
  const entry = (await getPlanCatalog()).get(currency.toLowerCase());
  return entry?.priceIds[planSlug]?.[interval] ?? null;
}
