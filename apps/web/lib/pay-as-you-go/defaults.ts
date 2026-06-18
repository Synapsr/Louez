import type { PayAsYouGoConfig } from '@louez/types';

import { env } from '@/env';

import {
  DEFAULT_PAY_AS_YOU_GO_CURRENCY,
  DEFAULT_PAY_AS_YOU_GO_TIERS,
  parsePayAsYouGoConfig,
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
  // PAYG_DEFAULT_PRICING may arrive as a parsed object (validation on) or a raw JSON
  // string (SKIP_ENV_VALIDATION makes @t3-oss skip the transform). parsePayAsYouGoConfig
  // handles both and rejects malformed input, so the offer applies identically in every
  // environment — never spread a raw string into the config again.
  const offer = parsePayAsYouGoConfig(env.PAYG_DEFAULT_PRICING);
  if (offer) {
    return { ...offer, currency: resolvedCurrency };
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
  // env.PAYG_FREE_RESERVATIONS is a number when validation runs, but a raw string (or
  // undefined) under SKIP_ENV_VALIDATION — undefined would make freeReservationsRemaining
  // NaN and write 0 instead of the gift at onboarding. Coerce defensively to a real int,
  // matching the schema default of 15.
  const n = Number(env.PAYG_FREE_RESERVATIONS);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 15;
}
