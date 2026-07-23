import Stripe from 'stripe'
import { env } from '@/env'

// Lazy-loaded Stripe client to avoid build-time errors
// Environment variables are only required at runtime
let stripeInstance: Stripe | null = null

export const getStripe = (): Stripe => {
  if (!stripeInstance) {
    if (!env.STRIPE_SECRET_KEY) {
      // Callers are expected to gate on isStripeConfigured() first; reaching
      // this without a key is a bug or an unconfigured instance using a
      // payment path directly.
      throw new Error('Stripe is not configured (STRIPE_SECRET_KEY is unset)')
    }
    stripeInstance = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
    })
  }
  return stripeInstance
}

// Backward compatibility export - lazy getter
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    return getStripe()[prop as keyof Stripe]
  },
})

export const getStripePublishableKey = () => {
  return env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
}
