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
 * Subscription plans configuration
 *
 * Plans are defined in code for simplicity and portability.
 * Stripe price IDs are loaded from environment variables.
 * If Stripe is not configured, paid plans are disabled.
 */
export const PLANS: Record<string, Plan> = {
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
    stripePriceMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    stripePriceYearly: process.env.STRIPE_PRICE_PRO_YEARLY,
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
    stripePriceMonthly: process.env.STRIPE_PRICE_ULTRA_MONTHLY,
    stripePriceYearly: process.env.STRIPE_PRICE_ULTRA_YEARLY,
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
 * Get all active plans
 */
export function getPlans(): Plan[] {
  return Object.values(PLANS)
}

/**
 * Get a plan by slug
 */
export function getPlan(slug: string): Plan | undefined {
  return PLANS[slug]
}

/**
 * Get the default (free) plan
 */
export function getDefaultPlan(): Plan {
  return PLANS.start
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
