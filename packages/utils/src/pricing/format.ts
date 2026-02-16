import { formatCurrency } from '../formatting'
import type {
  PricingMode,
  PricingTier,
  ProductPricing,
  PriceDisplayInfo,
  DurationPreview,
} from './types'
import {
  calculateEffectivePrice,
  calculateRentalPrice,
  sortTiersByDuration,
} from './calculate'

/**
 * Unit labels for each pricing mode
 */
const UNIT_LABELS: Record<
  PricingMode,
  { singular: string; plural: string; short: string }
> = {
  hour: { singular: 'heure', plural: 'heures', short: 'h' },
  day: { singular: 'jour', plural: 'jours', short: 'j' },
  week: { singular: 'semaine', plural: 'semaines', short: 'sem' },
}

/**
 * Format a duration with its unit label
 */
export function formatDuration(
  duration: number,
  mode: PricingMode,
  format: 'full' | 'short' = 'full'
): string {
  const labels = UNIT_LABELS[mode]

  if (format === 'short') {
    return `${duration}${labels.short}`
  }

  const label = duration === 1 ? labels.singular : labels.plural
  return `${duration} ${label}`
}

/**
 * Format a price with its per-unit suffix
 */
export function formatPricePerUnit(
  price: number,
  mode: PricingMode,
  format: 'full' | 'short' = 'short'
): string {
  const suffix =
    format === 'short'
      ? UNIT_LABELS[mode].short
      : UNIT_LABELS[mode].singular

  return `${formatCurrency(price)}/${suffix}`
}

/**
 * Format a tier label (e.g., "3+ jours")
 */
export function formatTierLabel(
  minDuration: number,
  mode: PricingMode
): string {
  const label =
    minDuration === 1
      ? UNIT_LABELS[mode].singular
      : UNIT_LABELS[mode].plural

  return `${minDuration}+ ${label}`
}

/**
 * Format discount percentage (e.g., "-20%")
 * Rounds to nearest integer for clean display
 */
export function formatDiscount(percent: number): string {
  return `-${Math.floor(percent)}%`
}

/**
 * Generate display info for a product's pricing
 */
export function getPriceDisplayInfo(pricing: ProductPricing): PriceDisplayInfo {
  const { basePrice, pricingMode, tiers } = pricing
  const hasTiers = tiers.length > 0
  const sortedTiers = sortTiersByDuration(tiers)

  // Calculate max discount
  let maxDiscount: number | null = null
  let tierSummary: string | null = null

  if (hasTiers) {
    maxDiscount = Math.max(...tiers.map((t) => t.discountPercent))
    const maxTier = tiers.find((t) => t.discountPercent === maxDiscount)
    if (maxTier) {
      tierSummary = `Jusqu'à -${maxDiscount}% dès ${formatTierLabel(maxTier.minDuration, pricingMode)}`
    }
  }

  return {
    basePrice: formatPricePerUnit(basePrice, pricingMode),
    effectivePrice: formatPricePerUnit(basePrice, pricingMode),
    hasTiers,
    tierSummary,
    maxDiscount,
    tiers: sortedTiers.map((tier) => {
      const effectivePrice = calculateEffectivePrice(basePrice, tier)
      return {
        minDuration: tier.minDuration,
        label: formatTierLabel(tier.minDuration, pricingMode),
        price: formatPricePerUnit(effectivePrice, pricingMode),
        discount: formatDiscount(tier.discountPercent),
      }
    }),
  }
}

/**
 * Generate duration previews for a product
 * Shows price at various durations to help customers understand the pricing
 */
export function generateDurationPreviews(
  pricing: ProductPricing,
  durations?: number[]
): DurationPreview[] {
  const { pricingMode, tiers } = pricing

  // Default durations based on pricing mode
  const defaultDurations: Record<PricingMode, number[]> = {
    hour: [1, 2, 4, 8, 24],
    day: [1, 3, 7, 14, 30],
    week: [1, 2, 4, 8, 12],
  }

  const durationsToShow = durations ?? defaultDurations[pricingMode]

  // Collect tier thresholds to highlight
  const tierThresholds = new Set(tiers.map((t) => t.minDuration))

  return durationsToShow
    .filter((d) => d > 0)
    .map((duration) => {
      const result = calculateRentalPrice(pricing, duration, 1)

      return {
        duration,
        label: formatDuration(duration, pricingMode),
        price: result.subtotal,
        priceFormatted: formatCurrency(result.subtotal),
        savings: result.savings,
        savingsFormatted:
          result.savings > 0 ? formatCurrency(result.savings) : '-',
        discountPercent: result.discountPercent,
        isHighlighted: tierThresholds.has(duration),
      }
    })
}

/**
 * Format a pricing summary for checkout display
 */
export function formatPricingSummary(
  basePrice: number,
  effectivePrice: number,
  duration: number,
  quantity: number,
  pricingMode: PricingMode,
  discount: number | null
): {
  lineItems: { label: string; value: string; isDiscount?: boolean }[]
  subtotal: string
} {
  const lineItems: { label: string; value: string; isDiscount?: boolean }[] = []

  // Base price line
  const basePriceTotal = basePrice * duration * quantity
  lineItems.push({
    label: `${quantity} × ${formatPricePerUnit(basePrice, pricingMode, 'full')} × ${formatDuration(duration, pricingMode)}`,
    value: formatCurrency(basePriceTotal),
  })

  // Discount line if applicable
  if (discount && discount > 0) {
    lineItems.push({
      label: `Réduction longue durée`,
      value: `- ${formatCurrency(discount)}`,
      isDiscount: true,
    })
  }

  // Subtotal
  const subtotal = effectivePrice * duration * quantity

  return {
    lineItems,
    subtotal: formatCurrency(subtotal),
  }
}

/**
 * Get the unit label for a pricing mode
 */
export function getUnitLabel(
  mode: PricingMode,
  variant: 'singular' | 'plural' | 'short' = 'singular'
): string {
  return UNIT_LABELS[mode][variant]
}

/**
 * Format savings badge text
 */
export function formatSavingsBadge(
  savings: number,
  discountPercent: number | null
): string {
  if (discountPercent) {
    return `${formatDiscount(discountPercent)} (${formatCurrency(savings)} économisés)`
  }
  return `${formatCurrency(savings)} économisés`
}

/**
 * Generate tier summary for product card badge
 */
export function formatTierBadge(
  tiers: PricingTier[],
  mode: PricingMode
): string | null {
  if (!tiers.length) return null

  const maxDiscount = Math.max(...tiers.map((t) => t.discountPercent))
  const minTier = tiers.reduce((min, t) =>
    t.minDuration < min.minDuration ? t : min
  )

  return `Jusqu'à -${maxDiscount}% dès ${minTier.minDuration}${UNIT_LABELS[mode].short}`
}
