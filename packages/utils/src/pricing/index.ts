// Types
export * from './types'

// Calculation utilities
export {
  calculateDuration,
  calculateDurationMinutes,
  findApplicableTier,
  calculateEffectivePrice,
  calculateRentalPrice,
  calculateFixedPrice,
  calculateRateBasedPrice,
  calculateUnitPrice,
  generatePricingBreakdown,
  getPricingModeLabel,
  validatePricingTiers,
  sortTiersByDuration,
  getAvailableDurations,
  snapToNearestTier,
  getAvailableDurationMinutes,
  snapToNearestRatePeriod,
  isRateBasedProduct,
  isFixedPriceProduct,
} from './calculate'

export {
  type DurationUnit,
  priceDurationToMinutes,
  minutesToPriceDuration,
  pricingModeToMinutes,
  perMinuteCost,
  computeReductionPercent,
} from './conversions'

// Tax utilities
export {
  type TaxConfig,
  type PriceCalculationResultWithTax,
  type TaxableLine,
  type TaxLineCalculation,
  type VatBreakdownEntry,
  type TaxBreakdownCalculation,
  type CalculateTaxBreakdownInput,
  calculateTaxFromExclusive,
  extractExclusiveFromInclusive,
  extractTaxFromInclusive,
  taxSettingsToConfig,
  getEffectiveTaxRate,
  calculateTaxBreakdown,
  applyTaxToCalculation,
  calculateRentalPriceWithTax,
  formatTaxLabel,
} from './tax'

// Seasonal pricing
export {
  findSeasonalPricingForDate,
  buildRawSegments,
  calculateSeasonalAwarePrice,
} from './seasonal'

// Formatting utilities
export {
  formatDuration,
  formatPricePerUnit,
  formatTierLabel,
  formatDiscount,
  getPriceDisplayInfo,
  generateDurationPreviews,
  formatPricingSummary,
  getUnitLabel,
  formatSavingsBadge,
  formatTierBadge,
} from './format'
