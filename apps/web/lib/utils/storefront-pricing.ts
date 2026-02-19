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

function findCheapestPerMinuteRate(rows: StorefrontRateRow[]): StorefrontRateRow {
  if (rows.length === 0) {
    return {
      id: '__base__',
      periodMinutes: 1440,
      price: 0,
      reductionPercent: 0,
    }
  }

  return rows.reduce((best, current) => {
    const bestPerMinute = best.price / best.periodMinutes
    const currentPerMinute = current.price / current.periodMinutes
    if (currentPerMinute < bestPerMinute) return current
    if (
      Math.abs(currentPerMinute - bestPerMinute) < 1e-9 &&
      current.periodMinutes < best.periodMinutes
    ) {
      return current
    }
    return best
  })
}

function getSmallestPeriodMinutes(rows: StorefrontRateRow[]): number {
  if (rows.length === 0) return 1440
  return Math.min(...rows.map((row) => row.periodMinutes))
}

function normalizePriceToPeriod(
  price: number,
  fromPeriodMinutes: number,
  targetPeriodMinutes: number,
): number {
  if (fromPeriodMinutes <= 0 || targetPeriodMinutes <= 0) return 0
  return (price / fromPeriodMinutes) * targetPeriodMinutes
}

export function getStorefrontRateRows(
  product: StorefrontPricingProduct,
): StorefrontRateRow[] {
  return normalizeRateRows(product)
}

export function getStorefrontPricingSummary(
  product: StorefrontPricingProduct,
): StorefrontPricingSummary {
  const rows = normalizeRateRows(product)
  const smallestPeriodMinutes = getSmallestPeriodMinutes(rows)
  const bestRate = findCheapestPerMinuteRate(rows)
  const normalizedBestPrice = normalizePriceToPeriod(
    bestRate.price,
    bestRate.periodMinutes,
    smallestPeriodMinutes,
  )
  const maxReductionPercent = Math.max(...rows.map((row) => row.reductionPercent), 0)

  return {
    displayPrice: normalizedBestPrice,
    displayPeriodMinutes: smallestPeriodMinutes,
    showStartingFrom: bestRate.id !== '__base__',
    maxReductionPercent,
  }
}
