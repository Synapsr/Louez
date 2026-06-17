import type { PayAsYouGoConfig } from '@louez/types';

import { env } from '@/env';

import {
  DEFAULT_PAY_AS_YOU_GO_CURRENCY,
  DEFAULT_PAY_AS_YOU_GO_TIERS,
} from './config';

/**
 * The pay-as-you-go pricing offer to SNAPSHOT onto a store at account creation.
 *
 * Returns the `PAYG_DEFAULT_PRICING` env override when configured (an ephemeral
 * launch offer deployed without a code change), otherwise the hardcoded platform
 * default ladder. At onboarding the value is snapshotted onto the store's subscription
 * row so that store keeps its pricing for life. Stores with NO stored config (e.g.
 * legacy accounts) read this env default live at runtime instead (see `getStoreBilling`),
 * so changing the env updates them immediately while snapshotted stores are unaffected.
 * Per-store edits stay possible from the platform-admin settings.
 *
 * The tariff numbers are currency-agnostic (the same offer in EUR, USD, …); `currency`
 * is set to the store's own currency so the stored record is accurate. Currency is also
 * enforced at read time from the store (see `getStoreBilling`), so this is belt-and-braces.
 *
 * Server-only (reads server env). Do not import from client components.
 */
export function getDefaultPayAsYouGoConfigSnapshot(
  currency?: string,
): PayAsYouGoConfig {
  const resolvedCurrency = (currency || DEFAULT_PAY_AS_YOU_GO_CURRENCY)
    .toLowerCase()
    .slice(0, 3);
  if (env.PAYG_DEFAULT_PRICING) {
    return { ...env.PAYG_DEFAULT_PRICING, currency: resolvedCurrency };
  }
  return {
    flatRateCents: null,
    tiers: DEFAULT_PAY_AS_YOU_GO_TIERS,
    currency: resolvedCurrency,
  };
}

/**
 * The number of free reservations to gift a NEW store at account creation. Snapshotted
 * onto the store so changing the env only affects future accounts. Server-only.
 */
export function getDefaultFreeReservations(): number {
  return env.PAYG_FREE_RESERVATIONS;
}
