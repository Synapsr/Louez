import type {
  PricingTier,
  ProductPricing,
  PriceCalculationResult,
  PricingMode,
  PricingBreakdown,
} from './types'

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

/**
 * Find the applicable pricing tier for a given duration
 * Returns the tier with the highest minDuration that the duration qualifies for
 */
export function findApplicableTier(
  tiers: PricingTier[],
  duration: number
): PricingTier | null {
  if (!tiers.length) return null

  // Sort by minDuration descending to find the best applicable tier
  const sortedTiers = [...tiers].sort((a, b) => b.minDuration - a.minDuration)

  return sortedTiers.find((tier) => duration >= tier.minDuration) ?? null
}

/**
 * Calculate the effective price per unit after applying tier discount
 */
export function calculateEffectivePrice(
  basePrice: number,
  tier: PricingTier | null
): number {
  if (!tier) return basePrice
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
    subtotal: Math.round(subtotal * 100) / 100,
    deposit: Math.round(totalDeposit * 100) / 100,
    total: Math.round(total * 100) / 100,
    effectivePricePerUnit: Math.round(effectivePricePerUnit * 100) / 100,
    basePrice,
    duration,
    quantity,
    discount: Math.round(savings * 100) / 100,
    discountPercent: tierApplied?.discountPercent ?? null,
    tierApplied,
    originalSubtotal: Math.round(originalSubtotal * 100) / 100,
    savings: Math.round(savings * 100) / 100,
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
  taxInfo?: { taxRate: number | null; taxAmount: number | null; subtotalExclTax: number | null; subtotalInclTax: number | null }
): PricingBreakdown {
  return {
    basePrice: result.basePrice,
    effectivePrice: result.effectivePricePerUnit,
    duration: result.duration,
    pricingMode,
    discountPercent: result.discountPercent,
    discountAmount: result.savings,
    tierApplied: result.tierApplied
      ? `${result.tierApplied.minDuration}+ ${getPricingModeLabel(pricingMode, result.tierApplied.minDuration > 1)}`
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
