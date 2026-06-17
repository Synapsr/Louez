import { z } from 'zod';

import type { PayAsYouGoConfig, PayAsYouGoTier } from '@louez/types';

/**
 * Canonical validation for a pay-as-you-go pricing config. Shared by the admin
 * settings action and the `PAYG_DEFAULT_PRICING` env var so the same rules apply
 * wherever a config enters the system. All fields are optional — an omitted field
 * falls back to the platform default in `resolvePayAsYouGoConfig`.
 */
export const payAsYouGoTierSchema = z.object({
  upToCount: z.number().int().positive().nullable(),
  priceCents: z.number().int().min(0).max(1_000_000),
});

export const payAsYouGoConfigSchema = z
  .object({
    flatRateCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
    tiers: z.array(payAsYouGoTierSchema).max(20).optional(),
    currency: z.string().length(3).optional(),
  })
  .superRefine((config, ctx) => {
    // Reject contradictory ladders: no two bands sharing an upper bound and at most
    // one open-ended band (otherwise the monthly total becomes order-dependent).
    const tiers = config.tiers ?? [];
    const bounds = tiers
      .map((t) => t.upToCount)
      .filter((c): c is number => c !== null);
    if (new Set(bounds).size !== bounds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate tier limit',
        path: ['tiers'],
      });
    }
    if (tiers.filter((t) => t.upToCount === null).length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Multiple open-ended tiers',
        path: ['tiers'],
      });
    }
  });

/**
 * Pay-as-you-go pricing math.
 *
 * Pricing is GRADUATED with a MONTHLY RESET: each rental ("location") is priced by
 * the band its 1-based position within the billing month falls into. With the ladder
 * `[{upTo:50,100c},{upTo:null,50c}]`, rentals 1..50 cost 100c each and the 51st costs
 * 50c (→ 50.50€ for 51 rentals). A `flatRateCents` overrides the ladder entirely
 * (the "lifetime exclusive" offer, e.g. 25c per rental).
 *
 * The authoritative monthly total `T(N)` depends only on the rental count `N` and the
 * ladder — never on the order rentals were created in — which is why mixing
 * online (collected at source) and manual (invoiced) rentals stays consistent.
 */

/** Platform default ladder, used when a store has no per-store override. */
export const DEFAULT_PAY_AS_YOU_GO_TIERS: PayAsYouGoTier[] = [
  { upToCount: 50, priceCents: 100 }, // 1€ for the first 50 rentals/month
  { upToCount: 200, priceCents: 80 }, // 0,80€ from 51 to 200
  { upToCount: null, priceCents: 50 }, // 0,50€ beyond 200
];

export const DEFAULT_PAY_AS_YOU_GO_CURRENCY = 'eur';

export interface ResolvedPayAsYouGoConfig {
  flatRateCents: number | null;
  tiers: PayAsYouGoTier[];
  currency: string;
}

/**
 * Sort tiers into evaluation order: ascending `upToCount`, with the open-ended
 * (`null`) band last. Defensive against admin input that isn't pre-sorted.
 */
function sortTiers(tiers: PayAsYouGoTier[]): PayAsYouGoTier[] {
  return [...tiers].sort((a, b) => {
    if (a.upToCount === null) return 1;
    if (b.upToCount === null) return -1;
    return a.upToCount - b.upToCount;
  });
}

/**
 * Normalize a (possibly partial / null) per-store config into a fully resolved one,
 * filling in platform defaults and ensuring a usable, sorted ladder.
 */
export function resolvePayAsYouGoConfig(
  config: PayAsYouGoConfig | null | undefined,
): ResolvedPayAsYouGoConfig {
  const currency = (config?.currency || DEFAULT_PAY_AS_YOU_GO_CURRENCY)
    .toLowerCase()
    .slice(0, 3);

  const flatRateCents =
    typeof config?.flatRateCents === 'number' && config.flatRateCents >= 0
      ? Math.round(config.flatRateCents)
      : null;

  const rawTiers =
    config?.tiers && config.tiers.length > 0
      ? config.tiers
      : DEFAULT_PAY_AS_YOU_GO_TIERS;

  // Keep only well-formed bands, then sort. If everything was filtered out, fall
  // back to the platform default so pricing never silently becomes free.
  const cleaned = rawTiers.filter(
    (t) =>
      (t.upToCount === null ||
        (typeof t.upToCount === 'number' && t.upToCount > 0)) &&
      typeof t.priceCents === 'number' &&
      t.priceCents >= 0,
  );

  const sorted = sortTiers(
    cleaned.length > 0 ? cleaned : DEFAULT_PAY_AS_YOU_GO_TIERS,
  );

  // Drop duplicate `upToCount` bands (keep first) and anything after the first
  // open-ended band, so the resolved ladder is deterministic regardless of input
  // order — T(N) then depends only on N and the ladder.
  const tiers: PayAsYouGoTier[] = [];
  const seenBounds = new Set<number>();
  for (const tier of sorted) {
    if (tier.upToCount === null) {
      tiers.push(tier);
      break;
    }
    if (seenBounds.has(tier.upToCount)) continue;
    seenBounds.add(tier.upToCount);
    tiers.push(tier);
  }

  // Guarantee a catch-all band so very high indices are always priced.
  if (tiers.length > 0 && tiers[tiers.length - 1].upToCount !== null) {
    tiers.push({
      upToCount: null,
      priceCents: tiers[tiers.length - 1].priceCents,
    });
  }

  return { flatRateCents, tiers, currency };
}

/**
 * Price (in cents) for the rental at 1-based monthly position `index`.
 */
export function priceForLocationIndex(
  config: ResolvedPayAsYouGoConfig,
  index: number,
): number {
  if (index < 1) return 0;
  if (config.flatRateCents !== null) return config.flatRateCents;

  for (const tier of config.tiers) {
    if (tier.upToCount === null || index <= tier.upToCount) {
      return tier.priceCents;
    }
  }
  // Should be unreachable thanks to the guaranteed catch-all band.
  return config.tiers[config.tiers.length - 1]?.priceCents ?? 0;
}

/**
 * Graduated total (in cents) for `n` rentals in a month: `Σ_{i=1..n} price(i)`.
 * Computed band-by-band, so it's O(tiers) regardless of `n`.
 */
export function graduatedTotalCents(
  config: ResolvedPayAsYouGoConfig,
  n: number,
): number {
  if (n <= 0) return 0;
  if (config.flatRateCents !== null) return n * config.flatRateCents;

  let total = 0;
  let prevBound = 0;
  for (const tier of config.tiers) {
    const upper = tier.upToCount === null ? n : Math.min(tier.upToCount, n);
    const countInBand = Math.max(0, upper - prevBound);
    total += countInBand * tier.priceCents;
    prevBound = upper;
    if (prevBound >= n) break;
  }
  return total;
}

/**
 * Build a `PayAsYouGoConfig` from admin form values (prices entered in whole
 * currency units, e.g. euros). Pure — keeps the euros→cents rounding and the
 * flat-rate/tiers branching out of the form component.
 */
export function buildPayAsYouGoConfig(
  values: {
    useFlatRate: boolean
    flatRateEuros: number
    tiers: { upToCount: number | null; priceEuros: number }[]
  },
  currency: string,
): { flatRateCents: number | null; tiers: PayAsYouGoTier[]; currency: string } {
  const toCents = (euros: number) => Math.round(euros * 100)
  if (values.useFlatRate) {
    return { flatRateCents: toCents(values.flatRateEuros), tiers: [], currency }
  }
  return {
    flatRateCents: null,
    tiers: values.tiers.map((tier) => ({
      upToCount: tier.upToCount,
      priceCents: toCents(tier.priceEuros),
    })),
    currency,
  }
}

export interface PayAsYouGoBandSummary {
  /** 1-based inclusive lower bound of the band. */
  from: number;
  /** Inclusive upper bound, or null for "and above". */
  to: number | null;
  priceCents: number;
}

/**
 * Human-friendly band ranges for display in the admin / subscription UI.
 */
export function summarizePayAsYouGoBands(
  config: ResolvedPayAsYouGoConfig,
): PayAsYouGoBandSummary[] {
  if (config.flatRateCents !== null) {
    return [{ from: 1, to: null, priceCents: config.flatRateCents }];
  }
  const bands: PayAsYouGoBandSummary[] = [];
  let prevBound = 0;
  for (const tier of config.tiers) {
    bands.push({
      from: prevBound + 1,
      to: tier.upToCount,
      priceCents: tier.priceCents,
    });
    if (tier.upToCount === null) break;
    prevBound = tier.upToCount;
  }
  return bands;
}
