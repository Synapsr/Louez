import type { Rate } from "@louez/types";
import { calculateRateBasedPrice } from "@louez/utils";

/**
 * Sampling for the price/duration curve.
 *
 * Every rate is an anchor; between and beyond them the curve is sampled on round
 * step sizes so the axis reads in whole hours, days or weeks rather than in
 * whatever the interval happened to divide into. Both billing modes are computed
 * for each sample, so a chart can show one and ghost the other without
 * re-deriving anything.
 */

export interface ChartDataPoint {
  durationMinutes: number;
  strictTotal: number;
  progressiveTotal: number;
  isTierAnchor: boolean;
}

export const ONE_WEEK_MINUTES = 10080;

/** Step sizes that produce round durations on the axis. */
const CLEAN_STEPS = [15, 30, 60, 120, 240, 360, 720, 1440, 2880, 4320, 10080];

/** The largest step that still leaves between 2 and 12 samples in the range. */
function pickStep(range: number): number {
  for (const step of CLEAN_STEPS) {
    const count = Math.floor(range / step) - 1;
    if (count >= 2 && count <= 12) return step;
  }
  return CLEAN_STEPS[CLEAN_STEPS.length - 1];
}

export function buildChartData(
  chartBasePrice: number,
  basePeriod: number,
  chartRates: Rate[],
  chartMaxMinutes?: number | null,
): ChartDataPoint[] {
  if (!chartBasePrice || !basePeriod) return [];

  const anchors = [basePeriod, ...chartRates.map((rate) => rate.period)].sort((a, b) => a - b);
  const anchorSet = new Set(anchors);
  const hasAdditionalRates = chartRates.length > 0;

  const sampleSet = new Set<number>(anchors);

  for (let i = 0; i < anchors.length - 1; i++) {
    const lo = anchors[i];
    const hi = anchors[i + 1];
    const step = pickStep(hi - lo);
    const start = Math.ceil((lo + 1) / step) * step;
    for (let value = start; value < hi; value += step) {
      sampleSet.add(value);
    }
  }

  const last = anchors[anchors.length - 1];
  const prevAnchor = anchors.length > 1 ? anchors[anchors.length - 2] : 0;
  const defaultChartMax = !hasAdditionalRates
    ? Math.max(basePeriod * 2, ONE_WEEK_MINUTES)
    : last + pickStep(last - prevAnchor || last) * 3;
  const targetChartMax = Math.max(defaultChartMax, chartMaxMinutes ?? 0);
  const extensionStep = pickStep(targetChartMax - last || last);
  const extensionStart = Math.ceil((last + 1) / extensionStep) * extensionStep;

  for (let value = extensionStart; value < targetChartMax; value += extensionStep) {
    sampleSet.add(value);
  }

  sampleSet.add(targetChartMax);

  const pricingBase = {
    basePrice: chartBasePrice,
    basePeriodMinutes: basePeriod,
    deposit: 0,
    rates: chartRates,
  };

  return [...sampleSet]
    .sort((a, b) => a - b)
    .map((minutes) => ({
      durationMinutes: minutes,
      strictTotal: calculateRateBasedPrice({ ...pricingBase, enforceStrictTiers: true }, minutes, 1)
        .subtotal,
      progressiveTotal: calculateRateBasedPrice(
        { ...pricingBase, enforceStrictTiers: false },
        minutes,
        1,
      ).subtotal,
      isTierAnchor: anchorSet.has(minutes),
    }));
}

/** Axis ticks: every anchor, plus the end of the range. */
export function buildChartTicks(data: ChartDataPoint[]): number[] {
  if (data.length === 0) return [];

  const ticks = data.filter((point) => point.isTierAnchor).map((point) => point.durationMinutes);
  const lastTick = data[data.length - 1]?.durationMinutes;

  if (lastTick && ticks[ticks.length - 1] !== lastTick) {
    ticks.push(lastTick);
  }

  // With few anchors the axis is nearly empty: densify with evenly spaced sample
  // points, keeping a minimum gap so labels never overlap.
  if (ticks.length < 4 && data.length >= 3) {
    const first = data[0].durationMinutes;
    const minGap = ((lastTick ?? first) - first) * 0.15;
    const step = Math.max(1, Math.floor(data.length / 5));
    for (let i = step; i < data.length; i += step) {
      const candidate = data[i].durationMinutes;
      if (ticks.every((tick) => Math.abs(tick - candidate) >= minGap)) {
        ticks.push(candidate);
      }
    }
    ticks.sort((a, b) => a - b);
  }

  return ticks;
}
