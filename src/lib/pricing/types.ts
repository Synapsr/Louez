import type { PricingMode, PricingTier, PricingBreakdown } from '@/types'

// Re-export core types for convenience
export type { PricingMode, PricingTier, PricingBreakdown }

/**
 * Product pricing configuration
 */
export interface ProductPricing {
  basePrice: number
  deposit: number
  pricingMode: PricingMode
  tiers: PricingTier[]
}

/**
 * Result of a price calculation
 */
export interface PriceCalculationResult {
  // Final amounts
  subtotal: number
  deposit: number
  total: number

  // Per-unit details
  effectivePricePerUnit: number
  basePrice: number
  duration: number
  quantity: number

  // Discount info
  discount: number
  discountPercent: number | null
  tierApplied: PricingTier | null

  // For display
  originalSubtotal: number
  savings: number
  savingsPercent: number
}

/**
 * Price display information for UI
 */
export interface PriceDisplayInfo {
  basePrice: string
  effectivePrice: string
  hasTiers: boolean
  tierSummary: string | null
  maxDiscount: number | null
  tiers: {
    minDuration: number
    label: string
    price: string
    discount: string
  }[]
}

/**
 * Duration preview entry
 */
export interface DurationPreview {
  duration: number
  label: string
  price: number
  priceFormatted: string
  savings: number
  savingsFormatted: string
  discountPercent: number | null
  isHighlighted: boolean
}

/**
 * Input for creating/updating pricing tiers
 */
export interface PricingTierInput {
  id?: string
  minDuration: number
  discountPercent: number
}
