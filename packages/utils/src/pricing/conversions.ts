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

export function minutesToPriceDuration(
  minutes: number,
): { duration: number; unit: DurationUnit } {
  if (minutes % MINUTES_PER_UNIT.week === 0) {
    return { duration: minutes / MINUTES_PER_UNIT.week, unit: 'week' }
  }
  if (minutes % MINUTES_PER_UNIT.day === 0) {
    return { duration: minutes / MINUTES_PER_UNIT.day, unit: 'day' }
  }
  if (minutes % MINUTES_PER_UNIT.hour === 0) {
    return { duration: minutes / MINUTES_PER_UNIT.hour, unit: 'hour' }
  }

  return { duration: minutes, unit: 'minute' }
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
