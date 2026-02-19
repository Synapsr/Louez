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

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function gcdOfList(values: number[]): number {
  if (values.length === 0) return 1
  return values.reduce((acc, value) => gcd(acc, value), values[0] || 1)
}

export function calculateBestRate(
  durationMinutes: number,
  rates: Rate[]
): {
  totalCost: number
  coveredMinutes: number
  plan: Array<{ rate: Rate; quantity: number }>
} {
  const normalizedRates = rates
    .filter((rate) => rate.period > 0 && rate.price >= 0)
    .sort((a, b) => a.period - b.period)

  if (normalizedRates.length === 0) {
    return {
      totalCost: 0,
      coveredMinutes: durationMinutes,
      plan: [],
    }
  }

  const targetMinutes = Math.max(1, Math.ceil(durationMinutes))
  const scale = gcdOfList(normalizedRates.map((rate) => rate.period))
  const rateSteps = normalizedRates.map((rate) =>
    Math.max(1, Math.round(rate.period / scale))
  )
  const targetSteps = Math.max(1, Math.ceil(targetMinutes / scale))
  const maxRateStep = Math.max(...rateSteps)
  const maxSteps = targetSteps + maxRateStep

  const dp = Array<number>(maxSteps + 1).fill(Number.POSITIVE_INFINITY)
  const segments = Array<number>(maxSteps + 1).fill(Number.POSITIVE_INFINITY)
  const prevStep = Array<number>(maxSteps + 1).fill(-1)
  const prevRateIdx = Array<number>(maxSteps + 1).fill(-1)

  dp[0] = 0
  segments[0] = 0

  for (let step = 1; step <= maxSteps; step += 1) {
    for (let i = 0; i < normalizedRates.length; i += 1) {
      const rateStep = rateSteps[i]
      if (step < rateStep) continue
      const source = step - rateStep
      if (!Number.isFinite(dp[source])) continue

      const candidateCost = dp[source] + normalizedRates[i].price
      const candidateSegments = segments[source] + 1

      const shouldReplace =
        candidateCost < dp[step] ||
        (Math.abs(candidateCost - dp[step]) < 1e-9 &&
          candidateSegments < segments[step])

      if (shouldReplace) {
        dp[step] = candidateCost
        segments[step] = candidateSegments
        prevStep[step] = source
        prevRateIdx[step] = i
      }
    }
  }

  let bestStep = -1
  for (let step = targetSteps; step <= maxSteps; step += 1) {
    if (!Number.isFinite(dp[step])) continue
    if (bestStep === -1 || dp[step] < dp[bestStep]) {
      bestStep = step
      continue
    }

    if (
      Math.abs(dp[step] - dp[bestStep]) < 1e-9 &&
      segments[step] < segments[bestStep]
    ) {
      bestStep = step
    }
  }

  if (bestStep === -1) {
    const fallback = normalizedRates[0]
    const count = Math.ceil(targetMinutes / fallback.period)
    return {
      totalCost: roundCurrency(count * fallback.price),
      coveredMinutes: count * fallback.period,
      plan: [{ rate: fallback, quantity: count }],
    }
  }

  const quantities = Array<number>(normalizedRates.length).fill(0)
  let cursor = bestStep
  while (cursor > 0) {
    const rateIdx = prevRateIdx[cursor]
    if (rateIdx < 0) break
    quantities[rateIdx] += 1
    cursor = prevStep[cursor]
  }

  const plan = normalizedRates
    .map((rate, index) => ({
      rate,
      quantity: quantities[index],
    }))
    .filter((entry) => entry.quantity > 0)

  return {
    totalCost: roundCurrency(dp[bestStep]),
    coveredMinutes: bestStep * scale,
    plan,
  }
}

export function calculateRentalPriceV2(
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

  const rates = [baseRate, ...(pricing.rates || [])]
  const best = calculateBestRate(durationMinutes, rates)
  const perItemSubtotal = best.totalCost
  const subtotal = perItemSubtotal * quantity
  const deposit = pricing.deposit * quantity
  const total = subtotal + deposit

  const basePeriods = Math.ceil(durationMinutes / pricing.basePeriodMinutes)
  const originalSubtotal = basePeriods * pricing.basePrice * quantity
  const savings = originalSubtotal - subtotal
  const reductionPercent =
    originalSubtotal > 0
      ? roundCurrency((savings / originalSubtotal) * 100)
      : null

  const dominant =
    [...best.plan].sort((a, b) => b.quantity - a.quantity)[0]?.rate ?? null

  return {
    subtotal: roundCurrency(subtotal),
    deposit: roundCurrency(deposit),
    total: roundCurrency(total),
    appliedRate: dominant,
    periodsUsed: best.plan.reduce((sum, entry) => sum + entry.quantity, 0),
    savings: roundCurrency(savings),
    reductionPercent,
    durationMinutes: Math.max(1, Math.ceil(durationMinutes)),
    quantity,
    originalSubtotal: roundCurrency(originalSubtotal),
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
