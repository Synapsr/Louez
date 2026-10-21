import type { BillingMode, PayAsYouGoConfig, PricingVersion } from '@louez/types';

import {
  DEFAULT_PAY_AS_YOU_GO_CURRENCY,
  BUILT_IN_PAY_AS_YOU_GO_TIERS,
  type ResolvedPayAsYouGoConfig,
  parsePayAsYouGoConfig,
  resolvePayAsYouGoConfig,
} from './config';

/**
 * Pricing lock: each store keeps the pricing frozen on its own subscription row.
 *
 * The offer for new stores (PAYG_DEFAULT_PRICING, PAYG_FREE_RESERVATIONS) is read only
 * when a store is created. Before this lock, a store with no stored config followed that
 * env value live; the pricing freeze copies what such a store was paying onto its row,
 * once. Pure module: no env, no database.
 */

/** Pricing versions (defined on `PricingVersion`). */
export const PAYG_LADDER_V1 = 'payg-ladder-v1' satisfies PricingVersion;
export const PAYG_CUSTOM = 'payg-custom' satisfies PricingVersion;

/**
 * Pricing applied to a store whose row carries no config (or that has no row at all),
 * which only happens if the pricing freeze has not run. Never read from the env, so
 * changing the offer for new stores cannot reprice such a store.
 */
export const LEGACY_PAY_AS_YOU_GO_CONFIG: PayAsYouGoConfig = {
  flatRateCents: null,
  tiers: BUILT_IN_PAY_AS_YOU_GO_TIERS,
};

/** Free reservations of a store that has no subscription row (the env default before the lock). */
export const LEGACY_FREE_RESERVATIONS = 15;

/** The subscription columns that decide what a store pays. */
export interface StoredStorePricing {
  billingMode: BillingMode;
  payAsYouGoConfig: PayAsYouGoConfig | null;
  freeReservationsGranted: number;
}

export interface ResolvedStorePricing {
  billingMode: BillingMode;
  config: ResolvedPayAsYouGoConfig;
  freeReservationsGranted: number;
  /** False when the row is missing or carries no config, so the legacy fallback applied. */
  frozen: boolean;
}

/**
 * Resolve what a store pays from its own subscription row. The commission currency
 * always follows the store, whatever the stored config says.
 */
export function resolveStorePricing(
  row: StoredStorePricing | null | undefined,
  storeCurrency: string,
): ResolvedStorePricing {
  const config = resolvePayAsYouGoConfig(row?.payAsYouGoConfig ?? LEGACY_PAY_AS_YOU_GO_CONFIG);
  config.currency = normalizeCurrency(storeCurrency);
  return {
    billingMode: row?.billingMode ?? 'pay_as_you_go',
    config,
    freeReservationsGranted: row ? row.freeReservationsGranted : LEGACY_FREE_RESERVATIONS,
    frozen: Boolean(row?.payAsYouGoConfig),
  };
}

/** Lowercase 3-letter ISO 4217 code, `eur` when unset. */
export function normalizeCurrency(currency: string | null | undefined): string {
  return (currency || DEFAULT_PAY_AS_YOU_GO_CURRENCY).toLowerCase().slice(0, 3);
}

/**
 * The per-rental offer configured by the env (PAYG_DEFAULT_PRICING), or the built-in
 * ladder when it is empty or malformed. Accepts the parsed object or the raw JSON string
 * (SKIP_ENV_VALIDATION skips the env transform).
 */
export function resolveEnvPayAsYouGoOffer(rawPricing: unknown): PayAsYouGoConfig {
  return parsePayAsYouGoConfig(rawPricing) ?? LEGACY_PAY_AS_YOU_GO_CONFIG;
}

/**
 * The free-reservation count configured by the env (PAYG_FREE_RESERVATIONS). A raw string
 * or undefined (SKIP_ENV_VALIDATION) is coerced; anything unusable gives the schema default.
 */
export function resolveEnvFreeReservations(rawFree: unknown): number {
  const n = Number(rawFree);
  return rawFree !== undefined && rawFree !== null && rawFree !== '' && Number.isFinite(n) && n >= 0
    ? Math.trunc(n)
    : LEGACY_FREE_RESERVATIONS;
}

/**
 * The config to store on a row: fully resolved (every tier written out), so the stored
 * pricing never depends on a code default again, with the store's currency.
 */
export function buildFrozenPayAsYouGoConfig(
  offer: PayAsYouGoConfig,
  currency: string,
): PayAsYouGoConfig {
  const resolved = resolvePayAsYouGoConfig(offer);
  return {
    flatRateCents: resolved.flatRateCents,
    tiers: resolved.tiers,
    currency: normalizeCurrency(currency),
  };
}

/** The pricing columns written on a subscription row. */
export interface SubscriptionPricingValues {
  pricingVersion: PricingVersion;
  payAsYouGoConfig: PayAsYouGoConfig;
  freeReservationsGranted: number;
}

/** The pricing a NEW store gets: the env offer, frozen on its row at creation. */
export function buildNewStorePricing(input: {
  rawPricing: unknown;
  rawFreeReservations: unknown;
  currency: string;
}): SubscriptionPricingValues {
  return {
    pricingVersion: PAYG_LADDER_V1,
    payAsYouGoConfig: buildFrozenPayAsYouGoConfig(
      resolveEnvPayAsYouGoOffer(input.rawPricing),
      input.currency,
    ),
    freeReservationsGranted: resolveEnvFreeReservations(input.rawFreeReservations),
  };
}

/**
 * The pricing written when a row is created for an EXISTING store that had none: exactly
 * what `resolveStorePricing` gives that store now, so creating the row changes nothing.
 */
export function buildExistingStorePricing(currency: string): SubscriptionPricingValues {
  return {
    pricingVersion: PAYG_LADDER_V1,
    payAsYouGoConfig: buildFrozenPayAsYouGoConfig(LEGACY_PAY_AS_YOU_GO_CONFIG, currency),
    freeReservationsGranted: LEGACY_FREE_RESERVATIONS,
  };
}

/** True when two configs charge the same price for every rental (currency is ignored). */
export function samePayAsYouGoPricing(
  a: PayAsYouGoConfig | null | undefined,
  b: PayAsYouGoConfig | null | undefined,
): boolean {
  const left = resolvePayAsYouGoConfig(a ?? LEGACY_PAY_AS_YOU_GO_CONFIG);
  const right = resolvePayAsYouGoConfig(b ?? LEGACY_PAY_AS_YOU_GO_CONFIG);
  if (left.flatRateCents !== null || right.flatRateCents !== null) {
    return left.flatRateCents === right.flatRateCents;
  }
  return (
    left.tiers.length === right.tiers.length &&
    left.tiers.every(
      (tier, i) =>
        tier.upToCount === right.tiers[i].upToCount &&
        tier.priceCents === right.tiers[i].priceCents,
    )
  );
}

/** The billing fields of the platform-admin settings form. */
export interface AdminBillingValues {
  billingMode: BillingMode;
  payAsYouGoConfig: PayAsYouGoConfig;
  freeReservationsGranted: number;
}

export interface AdminBillingPatch {
  billingMode?: BillingMode;
  payAsYouGoConfig?: PayAsYouGoConfig;
  pricingVersion?: PricingVersion;
  freeReservationsGranted?: number;
}

/**
 * The subscription columns an admin save writes: only the billing fields the admin
 * changed compared with the values the form was loaded with. A save therefore never
 * overwrites a referral reward granted while the form was open, and never re-saves
 * pricing nobody edited.
 * - Edited pricing is stored spelled out and tagged `payg-custom`.
 * - A row without config gets the pricing the admin saw (the legacy fallback) written down.
 * - Without a row the store can't be on real (Stripe) subscription billing: a paid plan
 *   requires checkout, so it stays pay-as-you-go.
 */
export function buildAdminBillingPatch(input: {
  submitted: AdminBillingValues;
  loaded: AdminBillingValues;
  /** The row before the save, null when the store had none. */
  stored: { payAsYouGoConfig: PayAsYouGoConfig | null } | null;
}): AdminBillingPatch {
  const { submitted, loaded, stored } = input;
  const patch: AdminBillingPatch = {};
  if (submitted.billingMode !== loaded.billingMode) {
    patch.billingMode = stored ? submitted.billingMode : 'pay_as_you_go';
  }
  const config = buildFrozenPayAsYouGoConfig(
    submitted.payAsYouGoConfig,
    submitted.payAsYouGoConfig.currency ?? '',
  );
  if (!samePayAsYouGoPricing(submitted.payAsYouGoConfig, loaded.payAsYouGoConfig)) {
    patch.payAsYouGoConfig = config;
    patch.pricingVersion = PAYG_CUSTOM;
  } else if (stored && !stored.payAsYouGoConfig) {
    patch.payAsYouGoConfig = config;
    patch.pricingVersion = PAYG_LADDER_V1;
  }
  if (submitted.freeReservationsGranted !== loaded.freeReservationsGranted) {
    patch.freeReservationsGranted = submitted.freeReservationsGranted;
  }
  return patch;
}
