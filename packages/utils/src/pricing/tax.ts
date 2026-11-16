import type { TaxSettings, ProductTaxSettings } from '@louez/types'
import type { PriceCalculationResult } from './types'
import { currencyMinorDigits } from '../billing-money'

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

export interface TaxableLine {
  id: string
  amount: number
  taxRate: number | null
}

export interface TaxLineCalculation {
  id: string
  taxRate: number | null
  discountAmount: number
  amountExclTax: number
  taxAmount: number
  amountInclTax: number
}

export interface VatBreakdownEntry {
  rate: number
  baseExclTax: number
  taxAmount: number
}

export interface TaxBreakdownCalculation {
  lines: TaxLineCalculation[]
  vatBreakdown: VatBreakdownEntry[]
  subtotalExclTax: number
  taxAmount: number
  totalInclTax: number
  depositAmount: number
}

export interface CalculateTaxBreakdownInput {
  lines: TaxableLine[]
  deliveryFee?: number
  discountAmount?: number
  depositAmount?: number
  taxConfig: TaxConfig | undefined
  discountableLineIds?: string[]
  /**
   * The currency the amounts are in: the tax, the discount and the totals are
   * allocated and rounded in its minor unit (¥1, 1 cent). Without one, or for a
   * three-decimal currency Louez does not carry, in cents.
   */
  currency?: string
}

/** The number of minor units in one unit of a currency: 1 for the yen, 100 for the euro. */
export function minorUnitsPerUnit(currency?: string): number {
  const digits = currency ? currencyMinorDigits(currency) : 2
  return digits === 0 ? 1 : 100
}

/**
 * An amount rounded to the currency's minor unit, half away from zero, on
 * the decimal value as written: 0.045 is 0.05 (where `toFixed(2)` reads the
 * binary 0.04499… and gives 0.04), ¥101.5 is ¥102. The one rounding of a
 * line's amount, for the dashboard's creation and its form.
 */
export function roundToMinorUnit(amount: number, currency?: string): number {
  const perUnit = minorUnitsPerUnit(currency)
  const scaled = Number((Math.abs(amount) * perUnit).toPrecision(15))
  return (Math.sign(amount) * Math.round(scaled)) / perUnit
}

function roundMoney(amount: number, perUnit = 100): number {
  return Math.round(amount * perUnit) / perUnit
}

function toMinor(amount: number, perUnit = 100): number {
  return Math.round(amount * perUnit)
}

function fromMinor(amount: number, perUnit = 100): number {
  return amount / perUnit
}

function allocateDiscountInMinorUnits(
  lines: TaxableLine[],
  discountAmount: number,
  taxEnabled: boolean,
  discountableLineIds: string[] | undefined,
  perUnit: number,
): number[] {
  const lineAmounts = lines.map((line) => Math.max(0, toMinor(line.amount, perUnit)))
  const eligibleIndexes = lines.flatMap((line, index) =>
    (discountableLineIds
      ? discountableLineIds.includes(line.id)
      : !taxEnabled || line.taxRate !== null) ? [index] : [],
  )
  const eligibleTotal = eligibleIndexes.reduce(
    (total, index) => total + lineAmounts[index],
    0,
  )
  const discount = Math.min(
    Math.max(0, toMinor(discountAmount, perUnit)),
    eligibleTotal,
  )
  const allocations = lines.map(() => 0)

  if (discount === 0 || eligibleTotal === 0) return allocations

  const total = BigInt(eligibleTotal)
  const remainders: { index: number; remainder: bigint }[] = []
  let allocated = 0

  for (const index of eligibleIndexes) {
    const numerator = BigInt(discount) * BigInt(lineAmounts[index])
    const share = Number(numerator / total)
    allocations[index] = share
    allocated += share
    remainders.push({ index, remainder: numerator % total })
  }

  remainders.sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index
    return left.remainder > right.remainder ? -1 : 1
  })

  for (let index = 0; index < discount - allocated; index++) {
    allocations[remainders[index].index] += 1
  }

  return allocations
}

// ============================================================================
// Tax Calculation Functions
// ============================================================================

/**
 * Calculate tax amount from an exclusive (HT) amount
 * Formula: taxAmount = amountExclTax * (rate / 100)
 */
export function calculateTaxFromExclusive(
  amountExclTax: number,
  rate: number,
  perUnit = 100,
): number {
  return Math.round(amountExclTax * (rate / 100) * perUnit) / perUnit
}

/**
 * Extract the exclusive (HT) amount from an inclusive (TTC) amount
 * Formula: amountExclTax = amountInclTax / (1 + rate / 100)
 */
export function extractExclusiveFromInclusive(
  amountInclTax: number,
  rate: number,
  perUnit = 100,
): number {
  return Math.round((amountInclTax / (1 + rate / 100)) * perUnit) / perUnit
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

export function calculateTaxBreakdown({
  lines,
  deliveryFee = 0,
  discountAmount = 0,
  depositAmount = 0,
  taxConfig,
  discountableLineIds,
  currency,
}: CalculateTaxBreakdownInput): TaxBreakdownCalculation {
  const perUnit = minorUnitsPerUnit(currency)
  const sourceLines = [
    ...lines,
    ...(deliveryFee > 0
      ? [
          {
            id: 'delivery',
            amount: deliveryFee,
            taxRate: taxConfig?.enabled ? taxConfig.rate : null,
          },
        ]
      : []),
  ]

  // Allocate document discounts in whole minor units using largest
  // remainders, then round the HT/TVA split on each discounted line. Rate
  // totals are sums of those line values, so the breakdown always reconciles
  // to the minor unit.
  const discountAllocations = allocateDiscountInMinorUnits(
    sourceLines,
    discountAmount,
    taxConfig?.enabled ?? false,
    discountableLineIds,
    perUnit,
  )
  const calculatedLines = sourceLines.map((line, index): TaxLineCalculation => {
    const allocatedDiscount = fromMinor(discountAllocations[index], perUnit)
    const amount = fromMinor(
      Math.max(0, toMinor(line.amount, perUnit) - discountAllocations[index]),
      perUnit,
    )

    if (!taxConfig?.enabled || line.taxRate === null) {
      return {
        id: line.id,
        taxRate: null,
        discountAmount: allocatedDiscount,
        amountExclTax: amount,
        taxAmount: 0,
        amountInclTax: amount,
      }
    }

    if (taxConfig.displayMode === 'inclusive') {
      const amountExclTax = extractExclusiveFromInclusive(amount, line.taxRate, perUnit)
      return {
        id: line.id,
        taxRate: line.taxRate,
        discountAmount: allocatedDiscount,
        amountExclTax,
        taxAmount: roundMoney(amount - amountExclTax, perUnit),
        amountInclTax: amount,
      }
    }

    const taxAmount = calculateTaxFromExclusive(amount, line.taxRate, perUnit)
    return {
      id: line.id,
      taxRate: line.taxRate,
      discountAmount: allocatedDiscount,
      amountExclTax: amount,
      taxAmount,
      amountInclTax: roundMoney(amount + taxAmount, perUnit),
    }
  })

  const breakdownByRate = new Map<string, VatBreakdownEntry>()
  for (const line of calculatedLines) {
    if (line.taxRate === null) continue

    const key = line.taxRate.toFixed(2)
    const breakdown = breakdownByRate.get(key) ?? {
      rate: line.taxRate,
      baseExclTax: 0,
      taxAmount: 0,
    }
    breakdown.baseExclTax = roundMoney(
      breakdown.baseExclTax + line.amountExclTax,
      perUnit,
    )
    breakdown.taxAmount = roundMoney(breakdown.taxAmount + line.taxAmount, perUnit)
    breakdownByRate.set(key, breakdown)
  }

  const subtotalExclTax = roundMoney(
    calculatedLines.reduce((total, line) => total + line.amountExclTax, 0),
    perUnit,
  )
  const taxAmount = roundMoney(
    calculatedLines.reduce((total, line) => total + line.taxAmount, 0),
    perUnit,
  )
  const totalInclTax = roundMoney(
    calculatedLines.reduce((total, line) => total + line.amountInclTax, 0),
    perUnit,
  )

  return {
    lines: calculatedLines,
    vatBreakdown: [...breakdownByRate.values()].sort(
      (left, right) => left.rate - right.rate,
    ),
    subtotalExclTax,
    taxAmount,
    totalInclTax,
    depositAmount: roundMoney(depositAmount, perUnit),
  }
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
  const calculation = calculateTaxBreakdown({
    lines: [{ id: 'subtotal', amount: result.subtotal, taxRate: rate }],
    depositAmount: result.deposit,
    taxConfig,
  })
  const depositAmount = calculation.depositAmount

  return {
    ...result,
    subtotalExclTax: calculation.subtotalExclTax,
    depositExclTax: depositAmount,
    totalExclTax: roundMoney(calculation.subtotalExclTax + depositAmount),
    subtotalTax: calculation.taxAmount,
    depositTax: 0,
    totalTax: calculation.taxAmount,
    subtotalInclTax: calculation.totalInclTax,
    depositInclTax: depositAmount,
    totalInclTax: roundMoney(calculation.totalInclTax + depositAmount),
    taxRate: rate,
    taxEnabled: true,
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
