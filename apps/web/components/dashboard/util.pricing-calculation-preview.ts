import type { Rate } from "@louez/types";
import { calculateRateBasedPrice } from "@louez/utils";

export const getPricingCalculationPreview = (
  basePrice: number,
  basePeriodMinutes: number,
  rates: Rate[],
  enforceStrictTiers: boolean,
): { durationMinutes: number; subtotal: number } => {
  const nextPeriod = rates
    .map((rate) => rate.period)
    .filter((period) => period > basePeriodMinutes)
    .sort((a, b) => a - b)[0];
  const extraMinutes =
    basePeriodMinutes >= 10080
      ? 1440
      : basePeriodMinutes >= 1440
        ? 60
        : basePeriodMinutes >= 60
          ? 15
          : 1;
  const durationMinutes = nextPeriod
    ? Math.ceil((basePeriodMinutes + nextPeriod) / 2)
    : basePeriodMinutes + extraMinutes;

  return {
    durationMinutes,
    subtotal: calculateRateBasedPrice(
      { basePrice, basePeriodMinutes, rates, enforceStrictTiers, deposit: 0 },
      durationMinutes,
      1,
    ).subtotal,
  };
};

export const formatPricingPreviewDuration = (minutes: number, locale: string): string => {
  const units =
    minutes % 10080 === 0
      ? [{ unit: "week", minutes: 10080 }]
      : [
          { unit: "day", minutes: 1440 },
          { unit: "hour", minutes: 60 },
          { unit: "minute", minutes: 1 },
        ];
  let remaining = minutes;
  return units
    .flatMap(({ unit, minutes: unitMinutes }) => {
      const count = Math.floor(remaining / unitMinutes);
      remaining %= unitMinutes;
      return count > 0
        ? [
            new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(
              count,
            ),
          ]
        : [];
    })
    .join(" ");
};
