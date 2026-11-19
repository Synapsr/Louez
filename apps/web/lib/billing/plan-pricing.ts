import { isStripeNotFound } from "@/lib/billing-sync/gross-backfill-core";
import { log } from "@/lib/evlog";
import {
  codePlanPricing,
  CODE_PRICED_CURRENCIES,
  DEFAULT_PLAN_CURRENCY,
  getPlans,
  isPlanCurrency,
  planCurrencyFor,
  type Currency,
  type Plan,
  type PlanPricing,
} from "@/lib/plans";
import { stripe } from "@/lib/stripe/client";

import { planPriceIds, planPricingFromStripe, type PlanStripePrice } from "./plan-pricing-core";

// The currency and amounts a store's plans are shown and sold in
// (docs/billing/devise-abonnement.md). EUR and USD amounts are the code's; any other
// currency shows its Stripe prices, read once every ten minutes per process, so the
// page never shows an amount Stripe would not bill.

const CACHE_MS = 10 * 60 * 1000;

const cache = new Map<string, { readonly at: number; readonly pricing: Promise<PlanPricing | null> }>();

async function readPrice(id: string): Promise<PlanStripePrice | null> {
  try {
    const price = await stripe.prices.retrieve(id);
    return {
      id: price.id,
      active: price.active,
      currency: price.currency,
      unitAmount: price.unit_amount,
      recurringInterval: price.recurring?.interval ?? null,
    };
  } catch (error) {
    if (isStripeNotFound(error)) return null;
    throw error;
  }
}

async function readPricing(plans: readonly Plan[], currency: Currency): Promise<PlanPricing | null> {
  const ids = planPriceIds(plans, currency);
  const prices = new Map<string, PlanStripePrice>();
  for (const price of await Promise.all(ids.map(readPrice))) {
    if (price) prices.set(price.id, price);
  }
  const { pricing, problem } = planPricingFromStripe(plans, currency, prices);
  if (problem) {
    log.warn(
      "billing",
      `plan prices in ${currency.toUpperCase()} cannot sell a plan (${problem.kind} ${problem.priceId}${problem.kind === "mismatch" ? ` ${problem.field}` : ""}): stores in it are billed in ${DEFAULT_PLAN_CURRENCY.toUpperCase()}`,
    );
  }
  return pricing;
}

/**
 * The plans' amounts in `currency`, or null when its prices cannot sell a plan: one is
 * missing, or Stripe bills it otherwise (planPricingFromStripe), or Stripe could not be
 * read. A failed read is not kept, so the next page tries again.
 */
export async function getPlanPricing(
  currency: Currency,
  plans: readonly Plan[] = getPlans(),
): Promise<PlanPricing | null> {
  if (CODE_PRICED_CURRENCIES.includes(currency)) return codePlanPricing(plans, currency);
  const key = `${currency}:${planPriceIds(plans, currency).join(",")}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.pricing;

  const pricing = readPricing(plans, currency).catch((error: unknown) => {
    cache.delete(key);
    log.error(
      "billing",
      `could not read the plan prices in ${currency.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  });
  cache.set(key, { at: Date.now(), pricing });
  return pricing;
}

/**
 * The currency and amounts a store buys a plan in: its own currency when every paid plan
 * has its prices in it and Stripe confirms them, EUR otherwise, as before.
 */
export async function getStorePlanPricing(storeCurrency: string | null | undefined): Promise<PlanPricing> {
  const plans = getPlans();
  const currency = planCurrencyFor(plans, storeCurrency);
  return (
    (await getPlanPricing(currency, plans)) ?? codePlanPricing(plans, DEFAULT_PLAN_CURRENCY)
  );
}

/**
 * What the plan page shows: a live subscription's own currency, which Stripe cannot
 * change (no amounts when its prices no longer sell a plan), or the store's
 * (getStorePlanPricing).
 */
export async function getPlanPagePricing(input: {
  storeCurrency: string | null | undefined;
  liveCurrency: string | null;
}): Promise<PlanPricing> {
  const live = input.liveCurrency?.toLowerCase() ?? null;
  if (live !== null && isPlanCurrency(live)) {
    return (await getPlanPricing(live)) ?? { currency: live, amounts: {} };
  }
  return getStorePlanPricing(input.storeCurrency);
}

/** The currency a store's plan Checkout bills (getStorePlanPricing). */
export async function getStorePlanCurrency(storeCurrency: string | null | undefined): Promise<Currency> {
  return (await getStorePlanPricing(storeCurrency)).currency;
}
