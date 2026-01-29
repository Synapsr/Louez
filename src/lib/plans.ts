import type { PlanFeatures } from '@/types'

export type Currency = 'eur' | 'usd'

export const SUPPORTED_CURRENCIES: Currency[] = ['eur', 'usd']

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  eur: '€',
  usd: '$',
}

// SMS top-up pricing per plan (in cents)
export const SMS_TOPUP_PRICING: Record<string, number | null> = {
  start: null, // Cannot top-up
  pro: 15, // 0.15€ per SMS
  ultra: 7, // 0.07€ per SMS
}

// Available SMS top-up packages
export const SMS_TOPUP_PACKAGES = [50, 100, 250, 500] as const
export type SmsTopupPackage = (typeof SMS_TOPUP_PACKAGES)[number]

export interface PlanPrices {
  monthly?: string
  yearly?: string
}

export interface Plan {
  slug: string
  name: string
  description: string
  price: number // Monthly price (same in EUR and USD)
  features: PlanFeatures
  isPopular?: boolean
  // Legacy fields for backwards compatibility
  stripePriceMonthly?: string
  stripePriceYearly?: string
  // Multi-currency support
  stripePrices?: Record<Currency, PlanPrices>
}

/**
 * Base plan definitions (without Stripe IDs)
 */
const BASE_PLANS: Record<string, Omit<Plan, 'stripePriceMonthly' | 'stripePriceYearly'>> = {
  start: {
    slug: 'start',
    name: 'Start',
    description: 'Pour démarrer gratuitement',
    price: 0,
    features: {
      maxProducts: 5,
      maxReservationsPerMonth: 10,
      maxCustomers: 50,
      maxCollaborators: 0,
      maxSmsPerMonth: 5,
      onlinePayment: false,
      analytics: false,
      emailNotifications: true,
      whiteLabel: false,
      customDomain: false,
      prioritySupport: false,
      customerPortal: false,
      reviewBooster: false,
      apiAccess: false,
      phoneSupport: false,
      dedicatedManager: false,
    },
  },
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
      onlinePayment: true,
      analytics: true,
      emailNotifications: true,
      whiteLabel: false,
      customDomain: false,
      prioritySupport: false,
      customerPortal: true,
      reviewBooster: true,
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
      onlinePayment: true,
      analytics: true,
      emailNotifications: true,
      whiteLabel: true,
      customDomain: true,
      prioritySupport: true,
      customerPortal: true,
      reviewBooster: true,
      apiAccess: true,
      phoneSupport: true,
      dedicatedManager: false,
    },
  },
}

/**
 * Get all active plans with Stripe price IDs injected at runtime
 * This ensures env vars are read at request time, not build time
 */
export function getPlans(): Plan[] {
  return [
    {
      ...BASE_PLANS.start,
    },
    {
      ...BASE_PLANS.pro,
      // Legacy EUR prices (backwards compatibility)
      stripePriceMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
      stripePriceYearly: process.env.STRIPE_PRICE_PRO_YEARLY,
      // Multi-currency support
      stripePrices: {
        eur: {
          monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
          yearly: process.env.STRIPE_PRICE_PRO_YEARLY,
        },
        usd: {
          monthly: process.env.STRIPE_PRICE_PRO_MONTHLY_USD,
          yearly: process.env.STRIPE_PRICE_PRO_YEARLY_USD,
        },
      },
    },
    {
      ...BASE_PLANS.ultra,
      // Legacy EUR prices (backwards compatibility)
      stripePriceMonthly: process.env.STRIPE_PRICE_ULTRA_MONTHLY,
      stripePriceYearly: process.env.STRIPE_PRICE_ULTRA_YEARLY,
      // Multi-currency support
      stripePrices: {
        eur: {
          monthly: process.env.STRIPE_PRICE_ULTRA_MONTHLY,
          yearly: process.env.STRIPE_PRICE_ULTRA_YEARLY,
        },
        usd: {
          monthly: process.env.STRIPE_PRICE_ULTRA_MONTHLY_USD,
          yearly: process.env.STRIPE_PRICE_ULTRA_YEARLY_USD,
        },
      },
    },
  ]
}

/**
 * Get a plan by slug with Stripe price IDs
 */
export function getPlan(slug: string): Plan | undefined {
  return getPlans().find((p) => p.slug === slug)
}

/**
 * Get the default (free) plan
 */
export function getDefaultPlan(): Plan {
  return { ...BASE_PLANS.start }
}

/**
 * Check if Stripe is configured for subscriptions
 */
export function isStripeConfigured(): boolean {
  return !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PRICE_PRO_MONTHLY &&
    process.env.STRIPE_PRICE_ULTRA_MONTHLY
  )
}

/**
 * Check if a plan is available for purchase in a specific currency
 */
export function isPlanAvailable(
  plan: Plan,
  interval: 'monthly' | 'yearly',
  currency: Currency = 'eur'
): boolean {
  if (plan.price === 0) return false // Free plan - no purchase needed
  const priceId = getPlanPriceId(plan, interval, currency)
  return !!priceId
}

/**
 * Get the Stripe price ID for a plan, interval, and currency
 */
export function getPlanPriceId(
  plan: Plan,
  interval: 'monthly' | 'yearly',
  currency: Currency = 'eur'
): string | undefined {
  // Try multi-currency prices first
  if (plan.stripePrices?.[currency]) {
    return interval === 'monthly'
      ? plan.stripePrices[currency].monthly
      : plan.stripePrices[currency].yearly
  }
  // Fallback to legacy EUR prices
  if (currency === 'eur') {
    return interval === 'monthly' ? plan.stripePriceMonthly : plan.stripePriceYearly
  }
  return undefined
}

/**
 * Get yearly price (2 months free)
 */
export function getYearlyPrice(plan: Plan): number {
  return plan.price * 10
}

/**
 * Format price with currency symbol
 */
export function formatPlanPrice(price: number, currency: Currency = 'eur'): string {
  const symbol = CURRENCY_SYMBOLS[currency]
  if (currency === 'eur') {
    return `${price}${symbol}`
  }
  return `${symbol}${price}`
}
