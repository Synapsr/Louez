import { z } from 'zod';

/**
 * Platform billing switch, `LOUEZ_BILLING`: whether this instance bills its stores.
 * Not to be confused with a store's own `BillingMode` (subscription or pay-as-you-go).
 * - `off` (the default): a self-hosted instance. Louez takes no Stripe Connect fee,
 *   records no fee, creates no subscription rows, runs no month-end billing, grants no
 *   referral rewards, sets no SMS or AI-credit quota and starts no platform charge. Rows
 *   an earlier version wrote are left as they are. LOUEZ_MODE (one store or several) is
 *   unrelated.
 * - `cloud`: Louez Cloud bills its stores.
 */
export type LouezBillingMode = 'off' | 'cloud';

/** The env schema (apps/web/env.ts): `off`, `cloud`, or unset, which means off. */
export const louezBillingSchema = z.enum(['off', 'cloud']).optional();

/**
 * Anything but `cloud` is off, so billing never starts by accident: the env schema
 * rejects other values, but SKIP_ENV_VALIDATION hands the raw string through.
 */
export function resolveBillingMode(raw: unknown): LouezBillingMode {
  return raw === 'cloud' ? 'cloud' : 'off';
}

/**
 * The raw `LOUEZ_BILLING` value, read from process.env at call time like
 * `isStandaloneMode()`: the prebuilt Docker image honors the runtime value, and modules
 * the ops scripts import (which have no app env) can call it without loading an env
 * schema. apps/web/env.ts validates it at runtime.
 */
export function getRawBillingSetting(): string | undefined {
  return process.env.LOUEZ_BILLING || undefined;
}

export function getBillingMode(): LouezBillingMode {
  return resolveBillingMode(getRawBillingSetting());
}

export function isBillingEnabled(): boolean {
  return getBillingMode() === 'cloud';
}

/** Thrown by a platform charge (Stripe customer, plan, top-up) when billing is off. */
export class BillingDisabledError extends Error {
  constructor(action: string) {
    super(`Platform billing is off (LOUEZ_BILLING is not "cloud"): cannot ${action}.`);
    this.name = 'BillingDisabledError';
  }
}

/**
 * The start-up error to log when billing is off by mistake, or null:
 * - a value that is neither `off` nor `cloud` (a typo the env schema did not stop, for
 *   instance under SKIP_ENV_VALIDATION) leaves billing off;
 * - a multi-store instance with paid plan prices but no LOUEZ_BILLING at all is most
 *   likely the cloud deployed without its switch: it would charge no store.
 */
export function describeBillingMisconfiguration(input: {
  louezBilling: string | undefined;
  platformMode: boolean;
  stripePriceProMonthly: string | undefined;
}): string | null {
  if (input.louezBilling !== undefined && !louezBillingSchema.safeParse(input.louezBilling).success) {
    return `LOUEZ_BILLING="${input.louezBilling}" is neither "off" nor "cloud", so billing is off. Set LOUEZ_BILLING=cloud or LOUEZ_BILLING=off.`;
  }
  if (input.louezBilling || !input.platformMode || !input.stripePriceProMonthly) return null;
  return (
    'Billing is off on what looks like Louez Cloud: LOUEZ_MODE=platform and ' +
    'STRIPE_PRICE_PRO_MONTHLY are set but LOUEZ_BILLING is not, so no store is charged ' +
    'and no fee is recorded. Set LOUEZ_BILLING=cloud, or LOUEZ_BILLING=off if this ' +
    'instance must not bill.'
  );
}
