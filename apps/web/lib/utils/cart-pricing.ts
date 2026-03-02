import type { PricingMode, Rate } from '@louez/types'
import {
  calculateRentalPrice,
  calculateRateBasedPrice,
  calculateDurationMinutes,
  calculateSeasonalAwarePrice,
  isRateBasedProduct,
  type ProductPricing,
  type SeasonalPricingConfig,
} from '@louez/utils'
import { calculateDuration } from '@/lib/utils/duration'

/**
 * Minimal cart item shape required for price calculation.
 * Compatible with CartItem from cart-context.
 */
interface CartItemForPricing {
  price: number
  deposit: number
  quantity: number
  startDate: string
  endDate: string
  pricingMode: PricingMode
  productPricingMode?: PricingMode | null
  basePeriodMinutes?: number | null
  enforceStrictTiers?: boolean
  pricingTiers?: {
    id: string
    minDuration: number
    discountPercent: number
    period?: number | null
    price?: number | null
  }[]
  seasonalPricings?: SeasonalPricingConfig[]
}

export interface CartItemPriceResult {
  subtotal: number
  originalSubtotal: number
  savings: number
  discountPercent: number | null
}

/**
 * Calculate the correct subtotal for a single cart item.
 *
 * Handles all pricing modes:
 * - Seasonal-aware pricing (segments by date range)
 * - Rate-based products (basePeriodMinutes, linear interpolation)
 * - Tier-based progressive pricing (minDuration + discountPercent)
 * - Simple fixed-price (basePrice * duration * quantity)
 *
 * This is the single source of truth for per-item pricing.
 * Used by cart-context, cart-sidebar, checkout-order-summary, and reservation-payload.
 */
export function calculateCartItemPrice(
  item: CartItemForPricing,
  globalStartDate: string | null,
  globalEndDate: string | null,
): CartItemPriceResult {
  const start = globalStartDate || item.startDate
  const end = globalEndDate || item.endDate
  const itemPricingMode = item.productPricingMode || item.pricingMode || 'day'

  // Build rates array from pricing tiers (for rate-based products)
  const rates: Rate[] = (item.pricingTiers || [])
    .filter(
      (tier): tier is typeof tier & { price: number; period: number } =>
        typeof tier.price === 'number' &&
        tier.price >= 0 &&
        typeof tier.period === 'number' &&
        tier.period > 0,
    )
    .map((tier, index) => ({
      id: tier.id,
      price: tier.price,
      period: tier.period,
      displayOrder: index,
    }))

  // 1. Seasonal-aware calculation (handles both rate-based and tier-based internally)
  if (item.seasonalPricings && item.seasonalPricings.length > 0 && start && end) {
    const result = calculateSeasonalAwarePrice(
      {
        basePrice: item.price,
        basePeriodMinutes: item.basePeriodMinutes ?? null,
        deposit: item.deposit,
        pricingMode: itemPricingMode,
        enforceStrictTiers: item.enforceStrictTiers ?? false,
        tiers: (item.pricingTiers || []).map((t, i) => ({
          id: t.id,
          minDuration: t.minDuration,
          discountPercent: t.discountPercent,
          displayOrder: i,
        })),
        rates,
      },
      item.seasonalPricings,
      start,
      end,
      item.quantity,
    )

    return {
      subtotal: result.subtotal,
      originalSubtotal: result.originalSubtotal,
      savings: result.savings,
      discountPercent:
        result.savings > 0 && result.originalSubtotal > 0
          ? Math.round((result.savings / result.originalSubtotal) * 100)
          : null,
    }
  }

  // 2. Rate-based products (basePeriodMinutes > 0)
  if (isRateBasedProduct({ basePeriodMinutes: item.basePeriodMinutes }) && start && end) {
    const durationMinutes = calculateDurationMinutes(start, end)

    const result = calculateRateBasedPrice(
      {
        basePrice: item.price,
        basePeriodMinutes: item.basePeriodMinutes!,
        deposit: item.deposit,
        rates,
        enforceStrictTiers: item.enforceStrictTiers ?? false,
      },
      durationMinutes,
      item.quantity,
    )

    return {
      subtotal: result.subtotal,
      originalSubtotal: result.originalSubtotal,
      savings: result.savings,
      discountPercent: result.reductionPercent,
    }
  }

  // 3. Tier-based progressive pricing
  if (item.pricingTiers && item.pricingTiers.length > 0 && start && end) {
    const duration = calculateDuration(start, end, itemPricingMode)
    const pricing: ProductPricing = {
      basePrice: item.price,
      deposit: item.deposit,
      pricingMode: itemPricingMode,
      tiers: item.pricingTiers.map((t, i) => ({
        ...t,
        displayOrder: i,
      })),
    }
    const result = calculateRentalPrice(pricing, duration, item.quantity)

    return {
      subtotal: result.subtotal,
      originalSubtotal: result.originalSubtotal,
      savings: result.savings,
      discountPercent: result.discountPercent,
    }
  }

  // 4. Simple fixed-price fallback
  const duration = start && end ? calculateDuration(start, end, itemPricingMode) : 1
  const subtotal = item.price * item.quantity * duration

  return {
    subtotal,
    originalSubtotal: subtotal,
    savings: 0,
    discountPercent: null,
  }
}
