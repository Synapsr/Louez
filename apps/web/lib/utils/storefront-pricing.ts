import type { PricingMode } from '@louez/types'
import {
  computeReductionPercent,
  isRateBasedProduct,
  pricingModeToMinutes,
} from '@louez/utils'

interface StorefrontPricingTier {
  id: string
  minDuration?: number | null
  discountPercent?: string | number | null
  period?: number | null
  price?: string | number | null
}

interface StorefrontPricingProduct {
  price: string | number
  pricingMode?: PricingMode | null
  basePeriodMinutes?: number | null
  pricingTiers?: StorefrontPricingTier[] | null
}

export interface StorefrontRateRow {
  id: string
  periodMinutes: number
  price: number
  reductionPercent: number
}

export interface StorefrontPricingSummary {
  displayPrice: number
  displayPeriodMinutes: number
  showStartingFrom: boolean
  maxReductionPercent: number
  allReductionPercents: number[]
}

function parseMoney(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function parsePercent(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function getLegacyPricingMode(mode?: PricingMode | null): PricingMode {
  if (mode === 'hour' || mode === 'week') return mode
  return 'day'
}

function normalizeRateRows(product: StorefrontPricingProduct): StorefrontRateRow[] {
  const basePrice = parseMoney(product.price)
  const pricingMode = getLegacyPricingMode(product.pricingMode)
  const basePeriodMinutes = isRateBasedProduct({
    basePeriodMinutes: product.basePeriodMinutes,
  })
    ? (product.basePeriodMinutes as number)
    : pricingModeToMinutes(pricingMode)

  const baseRate: StorefrontRateRow = {
    id: '__base__',
    periodMinutes: basePeriodMinutes,
    price: basePrice,
    reductionPercent: 0,
  }

  const tiers = product.pricingTiers ?? []
  const normalizedTierRows = isRateBasedProduct({
    basePeriodMinutes: product.basePeriodMinutes,
  })
    ? tiers
        .map((tier): StorefrontRateRow | null => {
          const periodMinutes =
            typeof tier.period === 'number' && tier.period > 0 ? tier.period : null
          if (!periodMinutes) return null

          const tierPrice = parseMoney(tier.price)
          const reduction = Math.max(
            0,
            computeReductionPercent(
              basePrice,
              basePeriodMinutes,
              tierPrice,
              periodMinutes,
            ),
          )

          return {
            id: tier.id,
            periodMinutes,
            price: tierPrice,
            reductionPercent: reduction,
          }
        })
        .filter((tier): tier is StorefrontRateRow => tier !== null)
    : tiers
        .map((tier): StorefrontRateRow | null => {
          const minDuration =
            typeof tier.minDuration === 'number' && tier.minDuration > 0
              ? tier.minDuration
              : null
          if (!minDuration) return null

          const discount = Math.max(0, parsePercent(tier.discountPercent))
          const unitPrice = basePrice * (1 - discount / 100)

          return {
            id: tier.id,
            periodMinutes: minDuration * basePeriodMinutes,
            price: unitPrice * minDuration,
            reductionPercent: discount,
          }
        })
        .filter((tier): tier is StorefrontRateRow => tier !== null)

  return [baseRate, ...normalizedTierRows].sort((a, b) => {
    if (a.periodMinutes !== b.periodMinutes) {
      return a.periodMinutes - b.periodMinutes
    }
    return a.price - b.price
  })
}

export function getStorefrontRateRows(
  product: StorefrontPricingProduct,
): StorefrontRateRow[] {
  return normalizeRateRows(product)
}

/**
 * Returns the pricing summary for a product card in the catalog (no dates selected).
 *
 * Always displays the base rate — the actual price a customer pays for
 * the shortest rental period. The discount badge (maxReductionPercent)
 * signals that longer-term savings are available.
 *
 * Previous behaviour normalised the cheapest per-minute rate to the base
 * period, producing misleading prices like "3.83 €/4 h" when the real
 * 4-hour price is 27 €.
 */
export function getStorefrontPricingSummary(
  product: StorefrontPricingProduct,
): StorefrontPricingSummary {
  const rows = normalizeRateRows(product)
  const baseRow = rows.find((r) => r.id === '__base__') ?? rows[0]
  const reductionPercents = rows.map((row) => row.reductionPercent).filter((p) => p > 0)
  const maxReductionPercent = Math.max(...reductionPercents, 0)

  return {
    displayPrice: baseRow.price,
    displayPeriodMinutes: baseRow.periodMinutes,
    showStartingFrom: false,
    maxReductionPercent,
    allReductionPercents: reductionPercents,
  }
}
