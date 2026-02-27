import type {
  PricingMode,
  PricingTier,
  PricingBreakdown,
  Rate,
} from '@louez/types'

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

export interface RateBasedPricing {
  basePrice: number
  basePeriodMinutes: number
  deposit: number
  rates: Rate[]
  enforceStrictTiers?: boolean
}

export interface RatePlanEntry {
  rate: Rate
  quantity: number
}

export interface RateCalculationResult {
  subtotal: number
  deposit: number
  total: number
  appliedRate: Rate | null
  periodsUsed: number
  savings: number
  reductionPercent: number | null
  durationMinutes: number
  quantity: number
  originalSubtotal: number
  plan: RatePlanEntry[]
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

// ============================================================================
// Seasonal Pricing
// ============================================================================

/**
 * Seasonal pricing configuration for a product.
 * Represents a date range with overridden pricing.
 */
export interface SeasonalPricingConfig {
  id: string
  name: string
  startDate: string // YYYY-MM-DD, inclusive
  endDate: string   // YYYY-MM-DD, inclusive
  basePrice: number
  tiers: PricingTier[]  // For progressive pricing
  rates: Rate[]         // For rate-based pricing
}

/**
 * A contiguous time segment within a reservation where a single pricing applies.
 */
export interface PricingSegment {
  startDate: Date
  endDate: Date
  seasonalPricingId: string | null   // null = base product pricing
  seasonalPricingName: string | null
  durationMinutes: number
  subtotal: number
  originalSubtotal: number
  savings: number
}

/**
 * Result of a seasonal-aware price calculation.
 */
export interface SeasonalPriceResult {
  segments: PricingSegment[]
  subtotal: number
  originalSubtotal: number
  savings: number
  deposit: number
  total: number
  isSeasonal: boolean // true if at least one segment uses seasonal pricing
}
