import { env } from '@/env';

import { type SubscriptionPricingValues, buildNewStorePricing } from './pricing-lock-core';

/**
 * The pricing written on a NEW store's subscription row at creation, when Louez's own
 * billing applies: the built-in ladder and `PAYG_FREE_RESERVATIONS`. The store keeps it
 * whatever the env says later.
 *
 * Server-only (reads server env). Do not import from client components.
 */
export function getNewStorePricing(currency: string): SubscriptionPricingValues {
  return buildNewStorePricing({
    rawFreeReservations: env.PAYG_FREE_RESERVATIONS,
    currency,
  });
}

