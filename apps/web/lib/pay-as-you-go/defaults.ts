import { env } from '@/env';

import {
  type SubscriptionPricingValues,
  buildNewStorePricing,
  resolveEnvFreeReservations,
  resolveEnvPayAsYouGoOffer,
} from './pricing-lock-core';
import type { LegacyPricingTerms } from './pricing-lock';

/**
 * The pricing written on a NEW store's subscription row at creation, when platform
 * billing is on: the `PAYG_DEFAULT_PRICING` offer (or the built-in ladder) and
 * `PAYG_FREE_RESERVATIONS`. The store keeps it whatever the env says later.
 *
 * Server-only (reads server env). Do not import from client components.
 */
export function getNewStorePricing(currency: string): SubscriptionPricingValues {
  return buildNewStorePricing({
    rawPricing: env.PAYG_DEFAULT_PRICING,
    rawFreeReservations: env.PAYG_FREE_RESERVATIONS,
    currency,
  });
}

/**
 * What a store that never had frozen pricing was paying before the pricing lock: this
 * deployment's env offer and allowance, which such stores followed live. Only the
 * start-up pricing freeze reads it, and only for stores it finds unfrozen (after the
 * first start of the lock, none). Server-only.
 */
export function getLegacyPricingTerms(): LegacyPricingTerms {
  return {
    offer: resolveEnvPayAsYouGoOffer(env.PAYG_DEFAULT_PRICING),
    freeReservations: resolveEnvFreeReservations(env.PAYG_FREE_RESERVATIONS),
  };
}
