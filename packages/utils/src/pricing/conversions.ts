export type DurationUnit = 'minute' | 'hour' | 'day' | 'week'

const MINUTES_PER_UNIT: Record<DurationUnit, number> = {
  minute: 1,
  hour: 60,
  day: 1440,
  week: 10080,
}

export function priceDurationToMinutes(
  duration: number,
  unit: DurationUnit,
): number {
  return Math.max(1, Math.round(duration * MINUTES_PER_UNIT[unit]))
}

const UNITS_LARGEST_FIRST: DurationUnit[] = ['week', 'day', 'hour', 'minute']

/**
 * Expresses a period in the largest unit that divides it evenly. `maxUnit`
 * caps that unit, so a ladder priced in days can keep 21 days as "21 days"
 * instead of switching that one row to "3 weeks".
 */
export function minutesToPriceDuration(
  minutes: number,
  maxUnit: DurationUnit = 'week',
): { duration: number; unit: DurationUnit } {
  const candidates = UNITS_LARGEST_FIRST.slice(
    UNITS_LARGEST_FIRST.indexOf(maxUnit),
  )
  const unit =
    candidates.find((candidate) => minutes % MINUTES_PER_UNIT[candidate] === 0) ??
    'minute'

  return { duration: minutes / MINUTES_PER_UNIT[unit], unit }
}

/**
 * Largest unit a rate tier is shown in, given the base rate's unit. A ladder
 * priced by the day or hour stays in days: 21 days is not shown as 3 weeks.
 */
export function tierDisplayMaxUnit(baseUnit: DurationUnit): DurationUnit {
  return baseUnit === 'week' ? 'week' : 'day'
}

export function pricingModeToMinutes(mode: 'hour' | 'day' | 'week'): number {
  switch (mode) {
    case 'hour':
      return MINUTES_PER_UNIT.hour
    case 'week':
      return MINUTES_PER_UNIT.week
    case 'day':
    default:
      return MINUTES_PER_UNIT.day
  }
}

export function perMinuteCost(price: number, periodMinutes: number): number {
  if (periodMinutes <= 0) return 0
  return price / periodMinutes
}

export function computeReductionPercent(
  basePrice: number,
  basePeriodMinutes: number,
  tierPrice: number,
  tierPeriodMinutes: number,
): number {
  const basePerMinute = perMinuteCost(basePrice, basePeriodMinutes)
  const tierPerMinute = perMinuteCost(tierPrice, tierPeriodMinutes)
  if (basePerMinute <= 0) return 0
  const reduction = (1 - tierPerMinute / basePerMinute) * 100
  return Math.round(reduction * 100) / 100
}
