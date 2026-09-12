import { applyProductPromotion } from "@louez/utils";
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  isFixedPriceProduct,
  pricingModeToMinutes,
  type SeasonalPricingConfig,
  type PricingSegment,
} from "@louez/utils";

import type { StorefrontProductPricing } from "@/lib/storefront/storefront.types";
import { getStorefrontRateRows, type StorefrontRateRow } from "@/lib/utils/util.storefront-pricing";
import { parseStorefrontDecimal } from "@/lib/utils/util.storefront-product-pricing";

export interface SeasonalCalendarSeason extends SeasonalPricingConfig {
  /** Rank among the product's seasons; picks the marker colour everywhere. */
  toneIndex: number;
}

export interface SeasonalCalendarPricing {
  basePrice: number;
  periodMinutes: number;
  seasons: SeasonalCalendarSeason[];
}

export interface StorefrontSeasonalRate {
  id: string;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  /** `null` for the standard rate, which owns no season colour. */
  toneIndex: number | null;
  rows: StorefrontRateRow[];
}

/** Seasons always rank by start date, so their colours agree across surfaces. */
const rankSeasons = (seasons: SeasonalPricingConfig[]): SeasonalCalendarSeason[] =>
  [...seasons]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((season, index) => ({ ...season, toneIndex: index }));

/** The same ranking, keyed by id, for surfaces that only hold price segments. */
export const getSeasonToneMap = (
  seasons: SeasonalPricingConfig[] | undefined,
): Map<string, number> =>
  new Map(rankSeasons(seasons ?? []).map((season) => [season.id, season.toneIndex]));

const getRegularSeasonalCalendarPricing = (
  product: StorefrontProductPricing,
): SeasonalCalendarPricing | undefined => {
  if (isFixedPriceProduct(product) || !product.seasonalPricings?.length) return undefined;
  return {
    basePrice: parseStorefrontDecimal(product.price) ?? 0,
    periodMinutes: product.basePeriodMinutes || pricingModeToMinutes(product.pricingMode ?? "day"),
    seasons: rankSeasons(product.seasonalPricings),
  };
};

export const getStorefrontSeasonalRates = (
  product: StorefrontProductPricing,
  options: { timezone?: string; now?: Date } = {},
): StorefrontSeasonalRate[] => {
  const pricing = getRegularSeasonalCalendarPricing(product);
  if (!pricing) return [];
  return [
    {
      id: "base",
      name: null,
      startDate: null,
      endDate: null,
      toneIndex: null,
      rows: getStorefrontRateRows(product, options),
    },
    ...pricing.seasons.map((season) => ({
      id: season.id,
      name: season.name,
      startDate: season.startDate,
      endDate: season.endDate,
      toneIndex: season.toneIndex,
      rows: getStorefrontRateRows(
        {
          ...product,
          price: season.basePrice,
          pricingTiers: product.basePeriodMinutes
            ? season.rates.map((rate) => ({ ...rate, minDuration: null, discountPercent: null }))
            : season.tiers,
        },
        options,
      ),
    })),
  ];
};

/** Season bounds are calendar dates, independent of the viewer's timezone. */
export const formatSeasonDateRange = (start: string, end: string, locale: string): string => {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return formatter
    .formatRange(new Date(`${start}T12:00:00`), new Date(`${end}T12:00:00`))
    .replace(/\s+/g, " ");
};

export const getSeasonalDurationParts = (minutes: number): number[] => {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  return [days * 1440, hours * 60, remainingMinutes].filter((part) => part > 0);
};

/** What one season contributed to a rental: its colour and its part of the price. */
export interface SeasonalPriceShare {
  id: string;
  name: string | null;
  toneIndex: number | null;
  subtotal: number;
}

/**
 * Folds a rental's segments into one entry per season — a period that leaves a
 * season and comes back counts once. Unknown seasons fall back to their order
 * of appearance so the colours stay distinct even without the product at hand.
 */
export const getSeasonalPriceShares = (
  segments: PricingSegment[],
  tones: Map<string, number>,
): SeasonalPriceShare[] => {
  const shares = new Map<string, SeasonalPriceShare>();
  let fallbackTone = 0;
  for (const segment of segments) {
    const id = segment.seasonalPricingId ?? "base";
    const known = shares.get(id);
    if (known) {
      known.subtotal += segment.subtotal;
      continue;
    }
    shares.set(id, {
      id,
      name: segment.seasonalPricingName ?? null,
      toneIndex: segment.seasonalPricingId
        ? (tones.get(segment.seasonalPricingId) ?? fallbackTone++)
        : null,
      subtotal: segment.subtotal,
    });
  }
  return [...shares.values()];
};

/**
 * Seasons grouped by marker colour, so the calendar marks days with one
 * modifier per colour instead of one per season.
 */
export const groupSeasonsByTone = (
  pricing: SeasonalCalendarPricing | undefined,
  toneCount: number,
): Map<number, SeasonalCalendarSeason[]> => {
  const tones = new Map<number, SeasonalCalendarSeason[]>();
  for (const season of pricing?.seasons ?? []) {
    const tone = season.toneIndex % toneCount;
    tones.set(tone, [...(tones.get(tone) ?? []), season]);
  }
  return tones;
};

export const getVisibleSeasonalPricing = (
  pricing: SeasonalCalendarPricing | undefined,
  month: Date,
  months: number,
): SeasonalCalendarPricing | undefined => {
  if (!pricing) return undefined;
  const start = format(startOfMonth(month), "yyyy-MM-dd");
  const end = format(endOfMonth(addMonths(month, months - 1)), "yyyy-MM-dd");
  return {
    ...pricing,
    seasons: pricing.seasons.filter((season) => season.startDate <= end && season.endDate >= start),
  };
};

export const getSeasonalHeadline = (
  product: StorefrontProductPricing,
  segments: PricingSegment[] | undefined,
  rentalPrice: number | undefined,
  options: { timezone?: string; rentalMinutes?: number } = {},
): { amount: number; mode: "from" | "period" | "season" | "base"; seasonName?: string } => {
  const { timezone, rentalMinutes } = options;
  const basePrice = parseStorefrontDecimal(product.price) ?? 0;
  const pricing = getRegularSeasonalCalendarPricing(product);
  if (!pricing) return { amount: basePrice, mode: "base" };
  if (rentalPrice === undefined) {
    const today = timezone
      ? formatInTimeZone(new Date(), timezone, "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd");
    return {
      amount: Math.min(
        basePrice,
        ...pricing.seasons
          .filter((season) => season.endDate >= today)
          .map((season) => season.basePrice),
      ),
      mode: "from",
    };
  }
  // A rental across several seasons has no single rate: the headline keeps the
  // per-period price the rest of the page speaks in, averaged over the rental.
  if (segments && segments.length > 1) {
    const periods = rentalMinutes ? rentalMinutes / pricing.periodMinutes : 0;
    return { amount: periods > 0 ? rentalPrice / periods : rentalPrice, mode: "period" };
  }
  const season = pricing.seasons.find((season) => season.id === segments?.[0]?.seasonalPricingId);
  return { amount: season?.basePrice ?? basePrice, mode: "season", seasonName: season?.name };
};

export const getSeasonalCalendarPricing = (
  product: StorefrontProductPricing,
  options: { timezone?: string; now?: Date } = {},
): SeasonalCalendarPricing | undefined => {
  const regular = getRegularSeasonalCalendarPricing(product);
  if (!regular) return undefined;
  const price = (amount: number) =>
    applyProductPromotion(amount, product.promotion, options.timezone, options.now).subtotal;
  return {
    ...regular,
    basePrice: price(regular.basePrice),
    seasons: regular.seasons.map((season) => ({ ...season, basePrice: price(season.basePrice) })),
  };
};
