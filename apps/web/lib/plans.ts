import type { PlanFeatures } from '@louez/types';

import { env } from '@/env';

export type Currency = 'eur' | 'usd';

export const SUPPORTED_CURRENCIES: Currency[] = ['eur', 'usd'];

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  eur: '€',
  usd: '$',
};

// SMS top-up pricing per plan (in cents)
export const SMS_TOPUP_PRICING: Record<string, number | null> = {
  pro: 15, // 0.15€ per SMS
  ultra: 7, // 0.07€ per SMS
  pay_as_you_go: 7, // 0.07€ per SMS (unlimited tier, Ultra parity)
};

// Available SMS top-up packages
export const SMS_TOPUP_PACKAGES = [50, 100, 250, 500] as const;
export type SmsTopupPackage = (typeof SMS_TOPUP_PACKAGES)[number];

// ── AI advisor credits ──────────────────────────────────────────────────────
// Every commercial value below is read from env — nothing is hardcoded, so the
// repo never reveals token cost, credit value or margin.

/**
 * Whether the paid AI-credit layer is active. When off (self-host default), the
 * advisor runs on rate-limits only: no metering, no gate, no billing UI.
 */
export function areAiCreditsEnabled(): boolean {
  return env.AI_CREDITS_ENABLED === 'true' || env.AI_CREDITS_ENABLED === '1';
}

/** Monthly INCLUDED credits per plan slug, parsed from env JSON. `{}` when unset. */
function getAiCreditsMonthlyIncluded(): Record<string, number> {
  const raw = env.AI_CREDIT_MONTHLY_INCLUDED;
  if (!raw) return {};
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [slug, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[slug] = Math.trunc(n);
    }
    return out;
  } catch {
    return {};
  }
}

export interface AiCreditPackage {
  credits: number;
  priceCents: number;
}

/** Credit packs sold via top-up, parsed from env JSON. Empty → top-up unavailable. */
export function getAiCreditPackages(): AiCreditPackage[] {
  const raw = env.AI_CREDIT_PACKAGES;
  if (!raw) return [];
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => ({
        credits: Math.trunc(Number((p as { credits?: unknown })?.credits)),
        priceCents: Math.trunc(
          Number((p as { priceCents?: unknown })?.priceCents),
        ),
      }))
      .filter(
        (p) =>
          Number.isFinite(p.credits) &&
          p.credits > 0 &&
          Number.isFinite(p.priceCents) &&
          p.priceCents > 0,
      );
  } catch {
    return [];
  }
}

export interface PlanPrices {
  monthly?: string;
  yearly?: string;
}

export interface Plan {
  slug: string;
  name: string;
  description: string;
  price: number; // Monthly price (same in EUR and USD)
  features: PlanFeatures;
  isPopular?: boolean;
  // Legacy fields for backwards compatibility
  stripePriceMonthly?: string;
  stripePriceYearly?: string;
  // Multi-currency support
  stripePrices?: Record<Currency, PlanPrices>;
}

/**
 * Base plan definitions (without Stripe IDs)
 */
const BASE_PLANS: Record<
  string,
  Omit<Plan, 'stripePriceMonthly' | 'stripePriceYearly'>
> = {
  pro: {
    slug: 'pro',
    name: 'Pro',
    description: 'Pour les loueurs professionnels',
    price: 49,
    isPopular: true,
    features: {
      maxProducts: 50,
      maxReservationsPerMonth: 100,
      maxCustomers: 500,
      maxCollaborators: 2,
      maxSmsPerMonth: 50,
      aiCreditsPerMonth: 0, // injected from env in getPlans()
      onlinePayment: true,
      analytics: true,
      emailNotifications: true,
      whiteLabel: false,
      customDomain: false,
      prioritySupport: false,
      customerPortal: true,
      reviewBooster: true,
      aiAdvisor: true,
      apiAccess: false,
      phoneSupport: false,
      dedicatedManager: false,
    },
  },
  ultra: {
    slug: 'ultra',
    name: 'Ultra',
    description: 'Pour les entreprises exigeantes',
    price: 159,
    features: {
      maxProducts: null, // unlimited
      maxReservationsPerMonth: null, // unlimited
      maxCustomers: null, // unlimited
      maxCollaborators: null, // unlimited
      maxSmsPerMonth: 500,
      aiCreditsPerMonth: 0, // injected from env in getPlans()
      onlinePayment: true,
      analytics: true,
      emailNotifications: true,
      whiteLabel: true,
      customDomain: true,
      prioritySupport: true,
      customerPortal: true,
      reviewBooster: true,
      aiAdvisor: true,
      apiAccess: true,
      phoneSupport: true,
      dedicatedManager: false,
    },
  },
};

/**
 * Pseudo-plan for pay-as-you-go stores. Not purchasable as a subscription — it is
 * returned by `getStorePlan` when a store's billing mode is `pay_as_you_go`. PAYG
 * stores pay per rental, so every limit is unlimited and every feature is unlocked.
 * Exception: pay-as-you-go includes NO free SMS — unlike Pro/Ultra which bundle a
 * monthly allowance, PAYG stores pay for every SMS (via top-up credits).
 */
export const PAY_AS_YOU_GO_PLAN: Plan = {
  slug: 'pay_as_you_go',
  name: 'Pay as you go',
  description: 'Facturation à la location',
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
    apiAccess: true,
    phoneSupport: true,
    dedicatedManager: false,
  },
};

export function getPayAsYouGoPlan(): Plan {
  return { ...PAY_AS_YOU_GO_PLAN };
}

/**
 * Get all active plans with Stripe price IDs injected at runtime
 * This ensures env vars are read at request time, not build time
 */
export function getPlans(): Plan[] {
  // Monthly included AI credits are injected here from env, never hardcoded.
  const aiMonthly = getAiCreditsMonthlyIncluded();
  return [
    {
      ...BASE_PLANS.pro,
      features: {
        ...BASE_PLANS.pro.features,
        aiCreditsPerMonth: aiMonthly.pro ?? 0,
      },
      // Legacy EUR prices (backwards compatibility)
      stripePriceMonthly: env.STRIPE_PRICE_PRO_MONTHLY,
      stripePriceYearly: env.STRIPE_PRICE_PRO_YEARLY,
      // Multi-currency support
      stripePrices: {
        eur: {
          monthly: env.STRIPE_PRICE_PRO_MONTHLY,
          yearly: env.STRIPE_PRICE_PRO_YEARLY,
        },
        usd: {
          monthly: env.STRIPE_PRICE_PRO_MONTHLY_USD,
          yearly: env.STRIPE_PRICE_PRO_YEARLY_USD,
        },
      },
    },
    {
      ...BASE_PLANS.ultra,
      features: {
        ...BASE_PLANS.ultra.features,
        aiCreditsPerMonth: aiMonthly.ultra ?? 0,
      },
      // Legacy EUR prices (backwards compatibility)
      stripePriceMonthly: env.STRIPE_PRICE_ULTRA_MONTHLY,
      stripePriceYearly: env.STRIPE_PRICE_ULTRA_YEARLY,
      // Multi-currency support
      stripePrices: {
        eur: {
          monthly: env.STRIPE_PRICE_ULTRA_MONTHLY,
          yearly: env.STRIPE_PRICE_ULTRA_YEARLY,
        },
        usd: {
          monthly: env.STRIPE_PRICE_ULTRA_MONTHLY_USD,
          yearly: env.STRIPE_PRICE_ULTRA_YEARLY_USD,
        },
      },
    },
  ];
}

/**
 * Get a plan by slug with Stripe price IDs
 */
export function getPlan(slug: string): Plan | undefined {
  return getPlans().find((p) => p.slug === slug);
}

/**
 * Default plan for stores with no usable subscription (e.g. uninitialized, cancelled,
 * or unknown slug). The free tier no longer exists, so the floor is pay-as-you-go:
 * the store keeps working with no monthly fee and is billed per rental instead.
 */
export function getDefaultPlan(): Plan {
  return getPayAsYouGoPlan();
}

/**
 * Check if Stripe is configured for subscriptions
 */
export function isStripeConfigured(): boolean {
  return !!(
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_PRICE_PRO_MONTHLY &&
    env.STRIPE_PRICE_ULTRA_MONTHLY
  );
}

/**
 * Check if a plan is available for purchase in a specific currency
 */
export function isPlanAvailable(
  plan: Plan,
  interval: 'monthly' | 'yearly',
  currency: Currency = 'eur',
): boolean {
  const priceId = getPlanPriceId(plan, interval, currency);
  return !!priceId;
}

/**
 * Get the Stripe price ID for a plan, interval, and currency
 */
export function getPlanPriceId(
  plan: Plan,
  interval: 'monthly' | 'yearly',
  currency: Currency = 'eur',
): string | undefined {
  // Try multi-currency prices first
  if (plan.stripePrices?.[currency]) {
    return interval === 'monthly'
      ? plan.stripePrices[currency].monthly
      : plan.stripePrices[currency].yearly;
  }
  // Fallback to legacy EUR prices
  if (currency === 'eur') {
    return interval === 'monthly'
      ? plan.stripePriceMonthly
      : plan.stripePriceYearly;
  }
  return undefined;
}

/**
 * Get yearly price (2 months free)
 */
export function getYearlyPrice(plan: Plan): number {
  return plan.price * 10;
}

/**
 * Format price with currency symbol
 */
export function formatPlanPrice(
  price: number,
  currency: Currency = 'eur',
): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  if (currency === 'eur') {
    return `${price}${symbol}`;
  }
  return `${symbol}${price}`;
}
