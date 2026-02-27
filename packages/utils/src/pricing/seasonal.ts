import type { PricingMode, Rate } from '@louez/types'

import type {
  SeasonalPricingConfig,
  PricingSegment,
  SeasonalPriceResult,
  ProductPricing,
  RateBasedPricing,
} from './types'
import {
  calculateRentalPrice,
  calculateRateBasedPrice,
  calculateDuration,
  calculateDurationMinutes,
  isRateBasedProduct,
} from './calculate'

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Find the seasonal pricing that applies for a given date.
 * Returns null if the date falls in the base pricing period.
 */
export function findSeasonalPricingForDate(
  seasonalPricings: SeasonalPricingConfig[],
  dateStr: string // YYYY-MM-DD
): SeasonalPricingConfig | null {
  for (const sp of seasonalPricings) {
    if (dateStr >= sp.startDate && dateStr <= sp.endDate) {
      return sp
    }
  }
  return null
}

/**
 * Format a Date as YYYY-MM-DD string.
 */
function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Add N days to a Date, returning a new Date at midnight.
 */
function addDays(d: Date, n: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + n)
  return result
}

/**
 * Get midnight (00:00) of a given date.
 */
function startOfDay(d: Date): Date {
  const result = new Date(d)
  result.setHours(0, 0, 0, 0)
  return result
}

interface RawSegment {
  firstDay: Date // midnight of first day
  lastDay: Date  // midnight of last day (inclusive)
  seasonalPricing: SeasonalPricingConfig | null
}

/**
 * Build contiguous segments from a reservation date range,
 * grouping consecutive days that share the same pricing.
 */
export function buildRawSegments(
  seasonalPricings: SeasonalPricingConfig[],
  startDate: Date,
  endDate: Date
): RawSegment[] {
  const segments: RawSegment[] = []

  // Walk day-by-day from startDate to endDate
  const firstDay = startOfDay(startDate)
  const lastDay = startOfDay(endDate)

  let currentDay = new Date(firstDay)

  while (currentDay <= lastDay) {
    const dateKey = toDateKey(currentDay)
    const sp = findSeasonalPricingForDate(seasonalPricings, dateKey)
    const spId = sp?.id ?? null

    const lastSegment = segments[segments.length - 1]
    const lastSpId = lastSegment?.seasonalPricing?.id ?? null

    if (lastSegment && lastSpId === spId) {
      // Extend current segment
      lastSegment.lastDay = new Date(currentDay)
    } else {
      // Start a new segment
      segments.push({
        firstDay: new Date(currentDay),
        lastDay: new Date(currentDay),
        seasonalPricing: sp,
      })
    }

    currentDay = addDays(currentDay, 1)
  }

  return segments
}

/**
 * Calculate a seasonal-aware rental price.
 *
 * If the product has no seasonal pricing, this delegates directly to the
 * existing calculation functions (zero overhead).
 *
 * When seasonal pricing exists and overlaps with the reservation dates,
 * the reservation is split into contiguous segments by pricing period.
 * Each segment is calculated independently and the results are summed.
 */
export function calculateSeasonalAwarePrice(
  product: {
    basePrice: number
    basePeriodMinutes: number | null
    deposit: number
    pricingMode: PricingMode
    enforceStrictTiers: boolean
    tiers: Array<{ id?: string; minDuration: number | null; discountPercent: number | null; displayOrder?: number }>
    rates: Rate[]
  },
  seasonalPricings: SeasonalPricingConfig[],
  startDate: Date | string,
  endDate: Date | string,
  quantity: number
): SeasonalPriceResult {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate
  const rateBased = isRateBasedProduct({ basePeriodMinutes: product.basePeriodMinutes })

  // Short-circuit: no seasonal pricing → use existing calculation
  if (!seasonalPricings.length) {
    return buildNonSeasonalResult(product, rateBased, start, end, quantity)
  }

  // Check if any seasonal pricing actually overlaps with the reservation
  const reservationStart = toDateKey(start)
  const reservationEnd = toDateKey(end)
  const hasOverlap = seasonalPricings.some(
    (sp) => sp.startDate <= reservationEnd && sp.endDate >= reservationStart
  )

  if (!hasOverlap) {
    return buildNonSeasonalResult(product, rateBased, start, end, quantity)
  }

  // Build day-by-day segments
  const rawSegments = buildRawSegments(seasonalPricings, start, end)

  // Calculate each segment
  const segments: PricingSegment[] = []
  let totalSubtotal = 0
  let totalOriginalSubtotal = 0
  let totalSavings = 0

  for (let i = 0; i < rawSegments.length; i++) {
    const raw = rawSegments[i]

    // Compute the actual time boundaries for this segment:
    // - First segment starts at the reservation's actual start time
    // - Last segment ends at the reservation's actual end time
    // - Intermediate segments span full days (midnight to midnight)
    const segStart = i === 0 ? start : raw.firstDay
    const segEnd =
      i === rawSegments.length - 1
        ? end
        : addDays(raw.lastDay, 1) // midnight of the day after last day

    const sp = raw.seasonalPricing
    const segBasePrice = sp ? sp.basePrice : product.basePrice
    const segRates = sp ? sp.rates : product.rates
    const segTiers = sp
      ? sp.tiers
      : product.tiers.map((t, idx) => ({ ...t, id: t.id ?? '', displayOrder: t.displayOrder ?? idx }))

    let subtotal: number
    let originalSubtotal: number
    let durationMinutes: number

    if (rateBased) {
      durationMinutes = calculateDurationMinutes(segStart, segEnd)

      const segPricing: RateBasedPricing = {
        basePrice: segBasePrice,
        basePeriodMinutes: product.basePeriodMinutes!,
        deposit: 0, // Deposit handled at the end, not per-segment
        rates: segRates,
        // Always use progressive interpolation within segments.
        // Strict mode (snap to nearest tier) would cause surfacturation
        // because each segment is shorter than the full reservation,
        // so every segment would independently snap up to its nearest tier,
        // billing more total days than the actual reservation duration.
        enforceStrictTiers: false,
      }

      const result = calculateRateBasedPrice(segPricing, durationMinutes, quantity)
      subtotal = result.subtotal
      originalSubtotal = result.originalSubtotal
    } else {
      const duration = calculateDuration(segStart, segEnd, product.pricingMode)
      durationMinutes = (segEnd.getTime() - segStart.getTime()) / (1000 * 60)

      const segPricing: ProductPricing = {
        basePrice: segBasePrice,
        deposit: 0,
        pricingMode: product.pricingMode,
        tiers: segTiers,
      }

      const result = calculateRentalPrice(segPricing, duration, quantity)
      subtotal = result.subtotal
      originalSubtotal = result.originalSubtotal
    }

    const savings = roundCurrency(Math.max(0, originalSubtotal - subtotal))

    segments.push({
      startDate: segStart,
      endDate: segEnd,
      seasonalPricingId: sp?.id ?? null,
      seasonalPricingName: sp?.name ?? null,
      durationMinutes: Math.max(1, Math.ceil(durationMinutes)),
      subtotal: roundCurrency(subtotal),
      originalSubtotal: roundCurrency(originalSubtotal),
      savings,
    })

    totalSubtotal += subtotal
    totalOriginalSubtotal += originalSubtotal
    totalSavings += savings
  }

  const deposit = roundCurrency(product.deposit * quantity)

  return {
    segments,
    subtotal: roundCurrency(totalSubtotal),
    originalSubtotal: roundCurrency(totalOriginalSubtotal),
    savings: roundCurrency(totalSavings),
    deposit,
    total: roundCurrency(totalSubtotal + deposit),
    isSeasonal: segments.some((s) => s.seasonalPricingId !== null),
  }
}

/**
 * Build a SeasonalPriceResult from the existing non-seasonal calculation.
 * Used as a fast path when no seasonal pricing applies.
 */
function buildNonSeasonalResult(
  product: {
    basePrice: number
    basePeriodMinutes: number | null
    deposit: number
    pricingMode: PricingMode
    enforceStrictTiers: boolean
    tiers: Array<{ id?: string; minDuration: number | null; discountPercent: number | null; displayOrder?: number }>
    rates: Rate[]
  },
  rateBased: boolean,
  start: Date,
  end: Date,
  quantity: number
): SeasonalPriceResult {
  let subtotal: number
  let originalSubtotal: number
  let durationMinutes: number
  const deposit = roundCurrency(product.deposit * quantity)

  if (rateBased) {
    durationMinutes = calculateDurationMinutes(start, end)

    const pricing: RateBasedPricing = {
      basePrice: product.basePrice,
      basePeriodMinutes: product.basePeriodMinutes!,
      deposit: product.deposit,
      rates: product.rates,
      enforceStrictTiers: product.enforceStrictTiers,
    }

    const result = calculateRateBasedPrice(pricing, durationMinutes, quantity)
    subtotal = result.subtotal
    originalSubtotal = result.originalSubtotal
  } else {
    const duration = calculateDuration(start, end, product.pricingMode)
    durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60)

    const pricing: ProductPricing = {
      basePrice: product.basePrice,
      deposit: product.deposit,
      pricingMode: product.pricingMode,
      tiers: product.tiers.map((t, idx) => ({ ...t, id: t.id ?? '', displayOrder: t.displayOrder ?? idx })),
    }

    const result = calculateRentalPrice(pricing, duration, quantity)
    subtotal = result.subtotal
    originalSubtotal = result.originalSubtotal
  }

  const savings = roundCurrency(Math.max(0, originalSubtotal - subtotal))

  return {
    segments: [
      {
        startDate: start,
        endDate: end,
        seasonalPricingId: null,
        seasonalPricingName: null,
        durationMinutes: Math.max(1, Math.ceil(durationMinutes)),
        subtotal: roundCurrency(subtotal),
        originalSubtotal: roundCurrency(originalSubtotal),
        savings,
      },
    ],
    subtotal: roundCurrency(subtotal),
    originalSubtotal: roundCurrency(originalSubtotal),
    savings,
    deposit,
    total: roundCurrency(subtotal + deposit),
    isSeasonal: false,
  }
}
