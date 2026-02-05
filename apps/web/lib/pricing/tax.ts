import type { TaxSettings, ProductTaxSettings } from '@louez/types'
import type { PriceCalculationResult } from './types'

// ============================================================================
// Tax Configuration Types
// ============================================================================

export interface TaxConfig {
  enabled: boolean
  rate: number
  displayMode: 'inclusive' | 'exclusive'
}

export interface PriceCalculationResultWithTax extends PriceCalculationResult {
  // Amounts excluding tax
  subtotalExclTax: number
  depositExclTax: number
  totalExclTax: number

  // Tax amounts
  subtotalTax: number
  depositTax: number // Always 0 (no tax on deposits)
  totalTax: number

  // Amounts including tax
  subtotalInclTax: number
  depositInclTax: number
  totalInclTax: number

  // Tax info
  taxRate: number | null
  taxEnabled: boolean
}

// ============================================================================
// Tax Calculation Functions
// ============================================================================

/**
 * Calculate tax amount from an exclusive (HT) amount
 * Formula: taxAmount = amountExclTax * (rate / 100)
 */
export function calculateTaxFromExclusive(amountExclTax: number, rate: number): number {
  return Math.round(amountExclTax * (rate / 100) * 100) / 100
}

/**
 * Extract the exclusive (HT) amount from an inclusive (TTC) amount
 * Formula: amountExclTax = amountInclTax / (1 + rate / 100)
 */
export function extractExclusiveFromInclusive(amountInclTax: number, rate: number): number {
  return Math.round((amountInclTax / (1 + rate / 100)) * 100) / 100
}

/**
 * Extract tax amount from an inclusive (TTC) amount
 * Formula: taxAmount = amountInclTax - amountExclTax
 */
export function extractTaxFromInclusive(amountInclTax: number, rate: number): number {
  const exclTax = extractExclusiveFromInclusive(amountInclTax, rate)
  return Math.round((amountInclTax - exclTax) * 100) / 100
}

/**
 * Convert store TaxSettings to TaxConfig
 */
export function taxSettingsToConfig(taxSettings?: TaxSettings): TaxConfig | undefined {
  if (!taxSettings?.enabled) return undefined

  return {
    enabled: taxSettings.enabled,
    rate: taxSettings.defaultRate,
    displayMode: taxSettings.displayMode,
  }
}

/**
 * Determine the effective tax rate for a product
 * Returns null if taxes are disabled
 */
export function getEffectiveTaxRate(
  storeTaxConfig: TaxConfig | undefined,
  productTaxSettings: ProductTaxSettings | undefined | null
): number | null {
  // No tax if not enabled at store level
  if (!storeTaxConfig?.enabled) return null

  // Use custom rate if product doesn't inherit from store
  if (productTaxSettings?.inheritFromStore === false && productTaxSettings.customRate !== undefined) {
    return productTaxSettings.customRate
  }

  // Default to store rate
  return storeTaxConfig.rate
}

/**
 * Apply taxes to a price calculation result
 * Note: Deposits (cautions) are NOT subject to tax
 */
export function applyTaxToCalculation(
  result: PriceCalculationResult,
  taxConfig: TaxConfig | undefined
): PriceCalculationResultWithTax {
  // If no tax config or tax disabled, return amounts as-is
  if (!taxConfig?.enabled) {
    return {
      ...result,
      // Without tax, all amounts are the same
      subtotalExclTax: result.subtotal,
      depositExclTax: result.deposit,
      totalExclTax: result.total,
      subtotalTax: 0,
      depositTax: 0,
      totalTax: 0,
      subtotalInclTax: result.subtotal,
      depositInclTax: result.deposit,
      totalInclTax: result.total,
      taxRate: null,
      taxEnabled: false,
    }
  }

  const rate = taxConfig.rate

  // Deposits are never taxed (they are returned)
  const depositExclTax = result.deposit
  const depositTax = 0
  const depositInclTax = result.deposit

  if (taxConfig.displayMode === 'exclusive') {
    // Prices are stored as HT (exclusive) -> calculate TTC (inclusive)
    const subtotalExclTax = result.subtotal
    const subtotalTax = calculateTaxFromExclusive(subtotalExclTax, rate)
    const subtotalInclTax = Math.round((subtotalExclTax + subtotalTax) * 100) / 100

    return {
      ...result,
      subtotalExclTax,
      depositExclTax,
      totalExclTax: Math.round((subtotalExclTax + depositExclTax) * 100) / 100,
      subtotalTax,
      depositTax,
      totalTax: subtotalTax, // Only subtotal is taxed, not deposit
      subtotalInclTax,
      depositInclTax,
      totalInclTax: Math.round((subtotalInclTax + depositInclTax) * 100) / 100,
      taxRate: rate,
      taxEnabled: true,
    }
  } else {
    // Prices are stored as TTC (inclusive) -> extract HT (exclusive)
    const subtotalInclTax = result.subtotal
    const subtotalExclTax = extractExclusiveFromInclusive(subtotalInclTax, rate)
    const subtotalTax = Math.round((subtotalInclTax - subtotalExclTax) * 100) / 100

    return {
      ...result,
      subtotalExclTax,
      depositExclTax,
      totalExclTax: Math.round((subtotalExclTax + depositExclTax) * 100) / 100,
      subtotalTax,
      depositTax,
      totalTax: subtotalTax, // Only subtotal is taxed, not deposit
      subtotalInclTax,
      depositInclTax,
      totalInclTax: Math.round((subtotalInclTax + depositInclTax) * 100) / 100,
      taxRate: rate,
      taxEnabled: true,
    }
  }
}

/**
 * Calculate rental price with tax support
 * Convenience function that combines calculateRentalPrice and applyTaxToCalculation
 */
export function calculateRentalPriceWithTax(
  calculateRentalPrice: (
    pricing: { basePrice: number; deposit: number; tiers: { minDuration: number; discountPercent: number }[] },
    duration: number,
    quantity: number
  ) => PriceCalculationResult,
  pricing: { basePrice: number; deposit: number; tiers: { minDuration: number; discountPercent: number }[] },
  duration: number,
  quantity: number,
  taxConfig?: TaxConfig
): PriceCalculationResultWithTax {
  const baseResult = calculateRentalPrice(pricing, duration, quantity)
  return applyTaxToCalculation(baseResult, taxConfig)
}

/**
 * Format tax amount for display
 */
export function formatTaxLabel(
  taxLabel: string | undefined,
  rate: number,
  locale: string = 'fr'
): string {
  const label = taxLabel || (locale === 'fr' ? 'TVA' : 'VAT')
  return `${label} (${rate}%)`
}
