"use client";

import { useCallback, useMemo } from "react";

import type { Rate } from "@louez/types";
import {
  type DurationUnit,
  calculateRateBasedPrice,
  computeReductionPercent,
  minutesToPriceDuration,
  priceDurationToMinutes,
} from "@louez/utils";

import {
  type ChartDataPoint,
  buildChartData,
  buildChartTicks,
} from "@/lib/utils/util.pricing-chart";
import type { PriceDurationValue } from "@/components/ui/price-duration-input";

import type { ProductFormComponentApi, ProductFormValues, RateTierInput } from "../types";

export function toNumber(value: string | undefined): number {
  const parsed = Number.parseFloat((value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortTiers(tiers: RateTierInput[]): RateTierInput[] {
  return [...tiers].sort(
    (a, b) =>
      priceDurationToMinutes(a.duration, a.unit) - priceDurationToMinutes(b.duration, b.unit),
  );
}

const DURATION_STEPS: Record<DurationUnit, number[]> = {
  minute: [1, 2, 6, 12, 24],
  hour: [1, 2, 4, 8, 24],
  day: [1, 3, 7, 14, 30],
  week: [1, 2, 4, 8, 12],
};

/**
 * Everything the three variants need, bound to the real TanStack form fields so
 * the floating save bar and validation keep working while the shape is judged.
 */
export function usePricingDraft(
  form: ProductFormComponentApi,
  watchedValues: ProductFormValues,
  onRateTiersEdit?: () => void,
) {
  const baseRate: PriceDurationValue = watchedValues.basePriceDuration ?? {
    price: watchedValues.price ?? "",
    duration: 1,
    unit:
      watchedValues.pricingMode === "week"
        ? "week"
        : watchedValues.pricingMode === "hour"
          ? "hour"
          : "day",
  };

  const setBaseRate = useCallback(
    (next: PriceDurationValue) => {
      form.setFieldValue("basePriceDuration", next);
      form.setFieldValue("price", next.price);
      form.setFieldValue(
        "pricingMode",
        next.unit === "week" ? "week" : next.unit === "day" ? "day" : "hour",
      );
    },
    [form],
  );

  const setTiers = useCallback(
    (next: RateTierInput[]) => {
      form.setFieldValue("rateTiers", sortTiers(next));
      onRateTiersEdit?.();
    },
    [form, onRateTiersEdit],
  );

  const setProrated = useCallback(
    (value: boolean) => form.setFieldValue("enforceStrictTiers", !value),
    [form],
  );

  return usePricingMath({
    baseRate,
    tiers: (watchedValues.rateTiers ?? []) as RateTierInput[],
    isProrated: !(watchedValues.enforceStrictTiers ?? true),
    setBaseRate,
    setTiers,
    setProrated,
  });
}

export interface PricingMathInput {
  baseRate: PriceDurationValue;
  tiers: RateTierInput[];
  isProrated: boolean;
  setBaseRate: (value: PriceDurationValue) => void;
  setTiers: (value: RateTierInput[]) => void;
  setProrated: (value: boolean) => void;
}

/**
 * Everything derived from a rate ladder: the curve, the example, the tier
 * economics, the mutators. Seasonal rates are the same maths over different
 * storage, so the two drafts share this and differ only in where state lives.
 */
export function usePricingMath({
  baseRate,
  tiers,
  isProrated,
  setBaseRate,
  setTiers: applyTiers,
  setProrated,
}: PricingMathInput) {
  const basePrice = toNumber(baseRate.price);
  const basePeriodMinutes = priceDurationToMinutes(baseRate.duration, baseRate.unit);
  const hasBaseRate = basePrice > 0 && basePeriodMinutes > 0;

  const setTiers = useCallback(
    (next: RateTierInput[]) => applyTiers(sortTiers(next)),
    [applyTiers],
  );

  const validRates: Rate[] = useMemo(
    () =>
      tiers
        .map((tier, index) => ({
          id: tier.id ?? `proto-${index}`,
          price: toNumber(tier.price),
          period: priceDurationToMinutes(tier.duration, tier.unit),
          displayOrder: index,
        }))
        .filter((rate) => rate.price > 0 && rate.period > 0),
    [tiers],
  );

  const curve = useMemo(
    () => buildChartData(basePrice, basePeriodMinutes, validRates),
    [basePrice, basePeriodMinutes, validRates],
  );
  const curveTicks = useMemo(() => buildChartTicks(curve), [curve]);

  /** Price of a rental of `minutes` in either mode — the two are worth comparing
   *  from the very first rate, since a lone base rate already bills differently. */
  const priceInMode = useCallback(
    (minutes: number, prorated: boolean) =>
      hasBaseRate
        ? calculateRateBasedPrice(
            {
              basePrice,
              basePeriodMinutes,
              rates: validRates,
              enforceStrictTiers: !prorated,
              deposit: 0,
            },
            minutes,
            1,
          ).subtotal
        : 0,
    [basePrice, basePeriodMinutes, hasBaseRate, validRates],
  );

  /** Price of a rental of `minutes`, in whichever mode is currently selected. */
  const priceAt = useCallback(
    (minutes: number) => priceInMode(minutes, isProrated),
    [isProrated, priceInMode],
  );

  /** A duration that lands *between* two rates — the only place the modes differ. */
  const exampleMinutes = useMemo(() => {
    const nextPeriod = validRates
      .map((rate) => rate.period)
      .filter((period) => period > basePeriodMinutes)
      .sort((a, b) => a - b)[0];
    if (nextPeriod) return Math.ceil((basePeriodMinutes + nextPeriod) / 2);
    // No tier yet: land halfway into a second base period, where "whole periods"
    // charges double and "prorated" charges one and a half.
    return Math.ceil(basePeriodMinutes * 1.5);
  }, [basePeriodMinutes, validRates]);

  /**
   * Two ways in, on purpose:
   * - `addTier()` appends the next step of the ladder, ten points cheaper than the
   *   one before it — the same helpful default the shipped editor gives you.
   * - `addTier(minutes)` drops an anchor *on* the current curve at that duration,
   *   so clicking the chart changes no price until you pull the anchor down.
   */
  const addTier = useCallback(
    (atMinutes?: number) => {
      if (!hasBaseRate) return;
      const last = tiers.at(-1);

      let duration: number;
      let unit: DurationUnit;
      if (atMinutes) {
        // Snap to a round duration so the anchor reads as "11 j", never "10 j 47 min".
        const snapped =
          atMinutes >= 1440
            ? Math.round(atMinutes / 1440) * 1440
            : Math.max(60, Math.round(atMinutes / 60) * 60);
        ({ duration, unit } = minutesToPriceDuration(snapped));
      } else {
        unit = last?.unit ?? baseRate.unit;
        const current = last?.duration ?? baseRate.duration;
        const base = baseRate.unit === unit ? baseRate.duration : 1;
        duration =
          DURATION_STEPS[unit].map((step) => step * base).find((value) => value > current) ??
          Math.ceil(current * 1.5);
      }

      const period = priceDurationToMinutes(duration, unit);
      if (period <= basePeriodMinutes) return;
      if (tiers.some((tier) => priceDurationToMinutes(tier.duration, tier.unit) === period)) return;

      if (atMinutes) {
        const onCurve = calculateRateBasedPrice(
          {
            basePrice,
            basePeriodMinutes,
            rates: validRates,
            enforceStrictTiers: !isProrated,
            deposit: 0,
          },
          period,
          1,
        ).subtotal;
        setTiers([...tiers, { price: onCurve.toFixed(2), duration, unit }]);
        return;
      }

      const previousDiscount = last
        ? (last.discountPercent ??
          computeReductionPercent(
            basePrice,
            basePeriodMinutes,
            toNumber(last.price),
            priceDurationToMinutes(last.duration, last.unit),
          ))
        : 0;
      const discountPercent = Math.min(99, Math.max(10, Math.round(previousDiscount + 10)));
      const price = Math.max(
        0,
        (basePrice / basePeriodMinutes) * (1 - discountPercent / 100) * period,
      ).toFixed(2);

      setTiers([...tiers, { price, duration, unit, discountPercent }]);
    },
    [baseRate, basePeriodMinutes, basePrice, hasBaseRate, isProrated, setTiers, tiers, validRates],
  );

  const removeTier = useCallback(
    (index: number) => setTiers(tiers.filter((_, i) => i !== index)),
    [setTiers, tiers],
  );

  const updateTier = useCallback(
    (index: number, next: RateTierInput) =>
      setTiers(tiers.map((tier, i) => (i === index ? next : tier))),
    [setTiers, tiers],
  );

  /** Re-derives the tier price from a discount slider, keeping the duration fixed. */
  const setTierDiscount = useCallback(
    (index: number, discountPercent: number) => {
      const tier = tiers[index];
      if (!tier || !hasBaseRate) return;
      const period = priceDurationToMinutes(tier.duration, tier.unit);
      const price = Math.max(
        0,
        (basePrice / basePeriodMinutes) * (1 - discountPercent / 100) * period,
      );
      updateTier(index, { ...tier, price: price.toFixed(2), discountPercent });
    },
    [basePeriodMinutes, basePrice, hasBaseRate, tiers, updateTier],
  );

  /** Undiscounted reference + realised discount for one tier row. */
  const tierEconomics = useCallback(
    (tier: RateTierInput) => {
      const period = priceDurationToMinutes(tier.duration, tier.unit);
      const price = toNumber(tier.price);
      const reference = hasBaseRate && period > 0 ? (basePrice / basePeriodMinutes) * period : 0;
      const discountPercent =
        tier.discountPercent ??
        (price > 0 && hasBaseRate
          ? computeReductionPercent(basePrice, basePeriodMinutes, price, period)
          : 0);
      return { period, price, reference, discountPercent, saves: Math.max(0, reference - price) };
    },
    [basePeriodMinutes, basePrice, hasBaseRate],
  );

  return {
    baseRate,
    setBaseRate,
    basePrice,
    basePeriodMinutes,
    hasBaseRate,
    tiers,
    setTiers,
    addTier,
    removeTier,
    updateTier,
    setTierDiscount,
    tierEconomics,
    isProrated,
    setProrated,
    validRates,
    curve,
    curveTicks,
    priceAt,
    priceInMode,
    exampleMinutes,
  };
}

export type PricingDraft = ReturnType<typeof usePricingMath>;
export type { ChartDataPoint };

/* ------------------------------------------------------------------ horizon */

const DAY_MINUTES = 1440;
const WEEK_MINUTES = 10080;
const MONTH_MINUTES = 43200;
const YEAR_MINUTES = 525600;

export interface HorizonPreset {
  /** `null` means "auto": just past the last rate. */
  minutes: number | null;
  count: number;
  unit: "day" | "week" | "month" | "year";
}

/**
 * How far the simulation looks. `null` is "auto" — just past the last rate, which
 * is all round 2 could show. The other presets scale with the base period, so an
 * hourly product offers days and a weekly one offers months.
 */
export function buildHorizonPresets(basePeriodMinutes: number): HorizonPreset[] {
  const auto: HorizonPreset = { minutes: null, count: 0, unit: "day" };

  if (basePeriodMinutes < DAY_MINUTES) {
    return [
      auto,
      { minutes: DAY_MINUTES, count: 1, unit: "day" },
      { minutes: WEEK_MINUTES, count: 1, unit: "week" },
      { minutes: MONTH_MINUTES, count: 1, unit: "month" },
    ];
  }
  if (basePeriodMinutes < WEEK_MINUTES) {
    return [
      auto,
      { minutes: WEEK_MINUTES, count: 1, unit: "week" },
      { minutes: MONTH_MINUTES, count: 1, unit: "month" },
      { minutes: MONTH_MINUTES * 3, count: 3, unit: "month" },
    ];
  }
  return [
    auto,
    { minutes: MONTH_MINUTES, count: 1, unit: "month" },
    { minutes: MONTH_MINUTES * 3, count: 3, unit: "month" },
    { minutes: YEAR_MINUTES, count: 1, unit: "year" },
  ];
}

/**
 * The curve re-sampled out to `horizonMinutes`. Past the last rate both modes
 * keep going — whole periods bills multiples of the largest rate, prorata
 * extrapolates its per-minute price — which is exactly what looking further is for.
 */
export function useHorizonCurve(draft: PricingDraft, horizonMinutes: number | null) {
  const curve = useMemo(
    () =>
      horizonMinutes === null
        ? draft.curve
        : buildChartData(
            draft.basePrice,
            draft.basePeriodMinutes,
            draft.validRates,
            horizonMinutes,
          ),
    [draft.basePrice, draft.basePeriodMinutes, draft.curve, draft.validRates, horizonMinutes],
  );
  const ticks = useMemo(
    () => (horizonMinutes === null ? draft.curveTicks : buildChartTicks(curve)),
    [curve, draft.curveTicks, horizonMinutes],
  );

  return { curve, ticks };
}

/** Curve values for one mode, for the sparklines that stand in for the chart. */
export function curveValues(draft: PricingDraft, mode: "whole" | "prorated"): number[] {
  const key = mode === "whole" ? "strictTotal" : "progressiveTotal";
  return draft.curve.map((point) => point[key]);
}
