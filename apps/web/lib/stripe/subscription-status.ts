import type Stripe from 'stripe'

import type { subscriptions } from '@louez/db'

/** The `status` column of a store's `subscriptions` row. */
export type SubscriptionRowStatus = (typeof subscriptions.$inferSelect)['status']

/**
 * The row status of a Stripe subscription status (louez-billing docs/api, README §8.7).
 *
 * For a store the billing service bills, only a subscription Stripe still collects
 * keeps its plan in force: `active`, `trialing` and `past_due`, Stripe's retry window,
 * stay as they are, and any other status is `cancelled`. Otherwise, today's reading:
 * `past_due`, `canceled` and `trialing` as they are, any other status `active`. At a
 * completed checkout that equals "`trialing`, else `active`".
 */
export function rowStatus(
  stripeStatus: Stripe.Subscription.Status,
  serviceBills: boolean,
): SubscriptionRowStatus {
  switch (stripeStatus) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'past_due':
      return 'past_due'
    case 'canceled':
      return 'cancelled'
    // `unpaid`, `incomplete`, `incomplete_expired`, `paused`, and any status Stripe adds.
    default:
      return serviceBills ? 'cancelled' : 'active'
  }
}
