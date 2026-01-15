import type { PlanFeatures } from '@/types'

export interface Plan {
  slug: string
  name: string
  description: string
  price: number // Monthly price in EUR
  features: PlanFeatures
  isPopular?: boolean
  stripePriceMonthly?: string
  stripePriceYearly?: string
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
    price: 29,
    isPopular: true,
    features: {
      maxProducts: 50,
      maxReservationsPerMonth: 100,
      maxCustomers: 500,
      maxCollaborators: 2,
      onlinePayment: true,
      analytics: true,
      emailNotifications: true,
      whiteLabel: false,
      customDomain: false,
      prioritySupport: false,
      customerPortal: true,
      reviewBooster: false,
      apiAccess: false,
      phoneSupport: false,
      dedicatedManager: false,
    },
  },
  ultra: {
    slug: 'ultra',
    name: 'Ultra',
    description: 'Pour les entreprises exigeantes',
    price: 79,
    features: {
      maxProducts: null, // unlimited
      maxReservationsPerMonth: null, // unlimited
      maxCustomers: null, // unlimited
      maxCollaborators: 10,
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
      stripePriceMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
      stripePriceYearly: process.env.STRIPE_PRICE_PRO_YEARLY,
    },
    {
      ...BASE_PLANS.ultra,
      stripePriceMonthly: process.env.STRIPE_PRICE_ULTRA_MONTHLY,
      stripePriceYearly: process.env.STRIPE_PRICE_ULTRA_YEARLY,
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
 * Check if a plan is available for purchase
 */
export function isPlanAvailable(plan: Plan, interval: 'monthly' | 'yearly'): boolean {
  if (plan.price === 0) return false // Free plan - no purchase needed
  const priceId = interval === 'monthly' ? plan.stripePriceMonthly : plan.stripePriceYearly
  return !!priceId
}

/**
 * Get yearly price (2 months free)
 */
export function getYearlyPrice(plan: Plan): number {
  return plan.price * 10
}
