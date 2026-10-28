import Stripe from 'stripe'
import { env } from '@/env'

/**
 * Whether stores can take online payments through Stripe Connect: the secret key and the
 * Connect webhook secret, which confirms their payments. Platform billing (plan prices,
 * the platform webhook) is a separate concern, on LOUEZ_BILLING=cloud.
 */
export const isConnectConfigured = (
  config: Pick<typeof env, 'STRIPE_SECRET_KEY' | 'STRIPE_CONNECT_WEBHOOK_SECRET'> = env,
): boolean => Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_CONNECT_WEBHOOK_SECRET)

// Lazy-loaded Stripe client to avoid build-time errors
// Environment variables are only required at runtime
let stripeInstance: Stripe | null = null

export const getStripe = (): Stripe => {
  if (!stripeInstance) {
    if (!env.STRIPE_SECRET_KEY) {
      // Callers are expected to gate on isConnectConfigured() first; reaching
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
