import type { Rate } from '@louez/types'

import type {
  PricingTier,
  ProductPricing,
  PriceCalculationResult,
  PricingMode,
  PricingBreakdown,
  RateBasedPricing,
  RateCalculationResult,
} from './types'

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Calculate duration between two dates based on pricing mode
 * Uses Math.ceil (round up) - industry standard: any partial period = full period billed
 */
export function calculateDuration(
  startDate: Date | string,
  endDate: Date | string,
  pricingMode: PricingMode
): number {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate
  const diffMs = end.getTime() - start.getTime()

  switch (pricingMode) {
    case 'hour':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)))
    case 'week':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)))
    case 'day':
    default:
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
  }
}

export function calculateDurationMinutes(
  startDate: Date | string,
  endDate: Date | string,
): number {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate
  const diffMs = end.getTime() - start.getTime()
  return Math.max(1, Math.ceil(diffMs / (1000 * 60)))
}

/**
 * Find the applicable pricing tier for a given duration
 * Returns the tier with the highest minDuration that the duration qualifies for
 */
export function findApplicableTier(
  tiers: PricingTier[],
  duration: number
): PricingTier | null {
  if (!tiers.length) return null

  const normalizedTiers = tiers.filter(
    (tier): tier is PricingTier & { minDuration: number; discountPercent: number } =>
      typeof tier.minDuration === 'number' &&
      tier.minDuration > 0 &&
      typeof tier.discountPercent === 'number'
  )
  if (!normalizedTiers.length) return null

  // Sort by minDuration descending to find the best applicable tier
  const sortedTiers = [...normalizedTiers].sort(
    (a, b) => b.minDuration - a.minDuration
  )

  return sortedTiers.find((tier) => duration >= tier.minDuration) ?? null
}

/**
 * Calculate the effective price per unit after applying tier discount
 */
export function calculateEffectivePrice(
  basePrice: number,
  tier: PricingTier | null
): number {
  if (!tier || typeof tier.discountPercent !== 'number') return basePrice
  return basePrice * (1 - tier.discountPercent / 100)
}

/**
 * Main pricing calculation function
 * Calculates total price for a rental with tiered pricing support
 */
export function calculateRentalPrice(
  pricing: ProductPricing,
  duration: number,
  quantity: number
): PriceCalculationResult {
  const { basePrice, deposit, tiers } = pricing

  // Find applicable tier
  const tierApplied = findApplicableTier(tiers, duration)

  // Calculate effective price per unit
  const effectivePricePerUnit = calculateEffectivePrice(basePrice, tierApplied)

  // Calculate totals
  const originalSubtotal = basePrice * duration * quantity
  const subtotal = effectivePricePerUnit * duration * quantity
  const totalDeposit = deposit * quantity
  const total = subtotal + totalDeposit

  // Calculate savings
  const savings = originalSubtotal - subtotal
  const savingsPercent =
    originalSubtotal > 0 ? Math.round((savings / originalSubtotal) * 100) : 0

  return {
    subtotal: roundCurrency(subtotal),
    deposit: roundCurrency(totalDeposit),
    total: roundCurrency(total),
    effectivePricePerUnit: roundCurrency(effectivePricePerUnit),
    basePrice,
    duration,
    quantity,
    discount: roundCurrency(savings),
    discountPercent: tierApplied?.discountPercent ?? null,
    tierApplied,
    originalSubtotal: roundCurrency(originalSubtotal),
    savings: roundCurrency(savings),
    savingsPercent,
  }
}

/**
 * Calculate price for a single unit at a specific duration (for preview)
 */
export function calculateUnitPrice(
  basePrice: number,
  tiers: PricingTier[],
  duration: number
): { price: number; discount: number | null } {
  const tier = findApplicableTier(tiers, duration)
  const effectivePrice = calculateEffectivePrice(basePrice, tier)

  return {
    price: effectivePrice * duration,
    discount: tier?.discountPercent ?? null,
  }
}

/**
 * Generate pricing breakdown for storing in reservation
 */
export function generatePricingBreakdown(
  result: PriceCalculationResult,
  pricingMode: PricingMode,
  taxInfo?: {
    taxRate: number | null
    taxAmount: number | null
    subtotalExclTax: number | null
    subtotalInclTax: number | null
  }
): PricingBreakdown {
  return {
    basePrice: result.basePrice,
    effectivePrice: result.effectivePricePerUnit,
    duration: result.duration,
    pricingMode,
    discountPercent: result.discountPercent,
    discountAmount: result.savings,
    tierApplied: result.tierApplied
      ? `${result.tierApplied.minDuration ?? 1}+ ${getPricingModeLabel(
          pricingMode,
          (result.tierApplied.minDuration ?? 1) > 1
        )}`
      : null,
    // Tax fields
    taxRate: taxInfo?.taxRate ?? null,
    taxAmount: taxInfo?.taxAmount ?? null,
    subtotalExclTax: taxInfo?.subtotalExclTax ?? null,
    subtotalInclTax: taxInfo?.subtotalInclTax ?? null,
  }
}

/**
 * Get pricing mode label
 */
export function getPricingModeLabel(
  mode: PricingMode,
  plural: boolean = false
): string {
  const labels: Record<PricingMode, { singular: string; plural: string }> = {
    hour: { singular: 'heure', plural: 'heures' },
    day: { singular: 'jour', plural: 'jours' },
    week: { singular: 'semaine', plural: 'semaines' },
  }

  return plural ? labels[mode].plural : labels[mode].singular
}

/**
 * Validate pricing tiers (no duplicates, valid values)
 */
export function validatePricingTiers(
  tiers: { minDuration: number; discountPercent: number }[]
): { valid: boolean; error: string | null } {
  // Check for duplicate durations
  const durations = tiers.map((t) => t.minDuration)
  const uniqueDurations = new Set(durations)
  if (durations.length !== uniqueDurations.size) {
    return {
      valid: false,
      error: 'Chaque palier doit avoir une durée minimum unique',
    }
  }

  // Check for valid values
  for (const tier of tiers) {
    if (tier.minDuration < 1) {
      return {
        valid: false,
        error: 'La durée minimum doit être au moins 1',
      }
    }
    if (tier.discountPercent < 0 || tier.discountPercent > 99) {
      return {
        valid: false,
        error: 'La réduction doit être entre 0 et 99%',
      }
    }
  }

  return { valid: true, error: null }
}

/**
 * Sort tiers by minDuration ascending (for display)
 */
export function sortTiersByDuration<T extends { minDuration: number }>(
  tiers: T[]
): T[] {
  return [...tiers].sort((a, b) => a.minDuration - b.minDuration)
}

/**
 * Get available durations when strict tiers are enforced (package pricing).
 * Returns null for progressive pricing (any duration allowed).
 * Always includes "1" (base unit price) plus all tier-defined durations.
 */
export function getAvailableDurations(
  tiers: { minDuration: number }[],
  enforceStrictTiers: boolean
): number[] | null {
  if (!enforceStrictTiers || tiers.length === 0) return null
  const durations = new Set([1, ...tiers.map((t) => t.minDuration)])
  return [...durations].sort((a, b) => a - b)
}

/**
 * Snap a duration to the nearest valid tier bracket (round up).
 * Used when enforceStrictTiers is true and a customer selects
 * a duration that falls between two defined brackets.
 */
export function snapToNearestTier(
  duration: number,
  availableDurations: number[]
): number {
  return (
    availableDurations.find((d) => d >= duration) ??
    availableDurations[availableDurations.length - 1]
  )
}

export function isRateBasedProduct(product: {
  basePeriodMinutes?: number | null
}): boolean {
  return Boolean(product.basePeriodMinutes && product.basePeriodMinutes > 0)
}

/**
 * Calculate rental price for rate-based products.
 *
 * Two modes controlled by `pricing.enforceStrictTiers`:
 *
 * **Strict (true)**: snap UP to nearest tier period, charge that tier's exact price.
 * Beyond the last tier, bill whole multiples of the largest tier.
 * Example: tiers at 4h,1j,2j,3j — rental of 2j2h → snap to 3j → 160€
 *
 * **Progressive (false, default)**: linear interpolation between adjacent tiers.
 * Tiers are anchor points on a price/duration curve; the price transitions
 * linearly from one tier to the next.
 * Example: tiers at base(4h,20€),1j(50€) — rental of 12h → 20+(50-20)×(720-240)/(1440-240) = 32€
 * Beyond the last tier, extrapolate at the last tier's per-minute rate.
 */
export function calculateRateBasedPrice(
  pricing: RateBasedPricing,
  durationMinutes: number,
  quantity: number
): RateCalculationResult {
  const baseRate: Rate = {
    id: '__base__',
    price: pricing.basePrice,
    period: pricing.basePeriodMinutes,
    displayOrder: -1,
  }

  // All rates including base, sorted by period ascending
  const allRates = [baseRate, ...(pricing.rates || [])]
    .filter((r) => r.period > 0 && r.price >= 0)
    .sort((a, b) => a.period - b.period)

  const targetMinutes = Math.max(1, Math.ceil(durationMinutes))

  if (allRates.length === 0) {
    const basePeriods = Math.ceil(targetMinutes / pricing.basePeriodMinutes)
    const sub = roundCurrency(basePeriods * pricing.basePrice * quantity)
    const dep = roundCurrency(pricing.deposit * quantity)
    return {
      subtotal: sub,
      deposit: dep,
      total: roundCurrency(sub + dep),
      appliedRate: null,
      periodsUsed: basePeriods,
      savings: 0,
      reductionPercent: null,
      durationMinutes: targetMinutes,
      quantity,
      originalSubtotal: sub,
      plan: [],
    }
  }

  const enforceStrict = pricing.enforceStrictTiers ?? false

  let perItemSubtotal: number
  let appliedRate: Rate
  let plan: Array<{ rate: Rate; quantity: number }>

  if (enforceStrict && allRates.length === 1) {
    // With only a base rate defined, fixed-tier mode means "bill full base
    // periods", while progressive mode still uses proportional pricing.
    const basePeriods = Math.ceil(targetMinutes / pricing.basePeriodMinutes)
    perItemSubtotal = roundCurrency(basePeriods * pricing.basePrice)
    appliedRate = baseRate
    plan = [{ rate: baseRate, quantity: basePeriods }]
  } else if (enforceStrict) {
    // STRICT MODE: snap UP to nearest tier period, charge that tier's exact price
    const snappedRate = allRates.find((r) => r.period >= targetMinutes)

    if (snappedRate) {
      perItemSubtotal = snappedRate.price
      appliedRate = snappedRate
      plan = [{ rate: snappedRate, quantity: 1 }]
    } else {
      // Duration exceeds all tiers: bill whole multiples of the largest tier
      const largest = allRates[allRates.length - 1]
      const largestTierPeriods = Math.ceil(targetMinutes / largest.period)
      perItemSubtotal = roundCurrency(largestTierPeriods * largest.price)
      appliedRate = largest
      plan = [{ rate: largest, quantity: largestTierPeriods }]
    }
  } else {
    // PROGRESSIVE MODE: linear interpolation between adjacent tiers
    //
    // Each tier is an anchor point on a price/duration curve. Between two
    // consecutive tiers, the price transitions in a straight line.
    // This guarantees: no price cliffs, monotonically non-decreasing prices,
    // and exact tier prices at tier boundaries.

    // Find the highest tier with period ≤ targetMinutes
    let floorIdx = -1
    for (let i = allRates.length - 1; i >= 0; i--) {
      if (allRates[i].period <= targetMinutes) {
        floorIdx = i
        break
      }
    }

    if (floorIdx === -1) {
      // Duration shorter than all tiers: charge 1 base period minimum
      perItemSubtotal = allRates[0].price
      appliedRate = allRates[0]
      plan = [{ rate: allRates[0], quantity: 1 }]
    } else {
      const floor = allRates[floorIdx]
      const ceil = allRates[floorIdx + 1] // undefined if beyond last tier

      if (floor.period === targetMinutes || !ceil) {
        // Exactly on a tier → exact tier price
        // Beyond last tier → extrapolate at last tier's per-minute rate
        perItemSubtotal = floor.period === targetMinutes
          ? floor.price
          : roundCurrency((floor.price / floor.period) * targetMinutes)
      } else {
        // Between two tiers → linear interpolation
        const t = (targetMinutes - floor.period) / (ceil.period - floor.period)
        perItemSubtotal = roundCurrency(floor.price + (ceil.price - floor.price) * t)
      }

      appliedRate = floor
      plan = [{ rate: floor, quantity: 1 }]
    }
  }

  const subtotal = roundCurrency(perItemSubtotal * quantity)
  const deposit = roundCurrency(pricing.deposit * quantity)
  const total = roundCurrency(subtotal + deposit)

  // Original subtotal: base rate × base periods (what it would cost without discounts)
  const basePeriods = Math.ceil(targetMinutes / pricing.basePeriodMinutes)
  const originalSubtotal = roundCurrency(basePeriods * pricing.basePrice * quantity)
  const savings = roundCurrency(Math.max(0, originalSubtotal - subtotal))
  const reductionPercent =
    originalSubtotal > 0 && savings > 0
      ? roundCurrency((savings / originalSubtotal) * 100)
      : null

  return {
    subtotal,
    deposit,
    total,
    appliedRate,
    periodsUsed: plan.reduce((sum, entry) => sum + entry.quantity, 0),
    savings,
    reductionPercent,
    durationMinutes: targetMinutes,
    quantity,
    originalSubtotal,
    plan,
  }
}

export function getAvailableDurationMinutes(
  rates: Array<{ period: number }>,
  enforceStrictTiers: boolean
): number[] | null {
  if (!enforceStrictTiers || rates.length === 0) return null
  const periods = new Set(rates.map((rate) => rate.period).filter((v) => v > 0))
  return [...periods].sort((a, b) => a - b)
}

export function snapToNearestRatePeriod(
  durationMinutes: number,
  availablePeriods: number[]
): number {
  return (
    availablePeriods.find((period) => period >= durationMinutes) ??
    availablePeriods[availablePeriods.length - 1]
  )
}
