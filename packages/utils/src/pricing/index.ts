// Types
export * from './types'

// Calculation utilities
export {
  calculateDuration,
  calculateDurationMinutes,
  findApplicableTier,
  calculateEffectivePrice,
  calculateRentalPrice,
  calculateRentalPriceV2,
  calculateBestRate,
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
  calculateTaxFromExclusive,
  extractExclusiveFromInclusive,
  extractTaxFromInclusive,
  taxSettingsToConfig,
  getEffectiveTaxRate,
  applyTaxToCalculation,
  calculateRentalPriceWithTax,
  formatTaxLabel,
} from './tax'

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
