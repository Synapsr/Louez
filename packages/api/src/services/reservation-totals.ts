import type { AppliedProductPromotion, ProductTaxSettings, TaxSettings } from "@louez/types";
import {
  calculateTaxBreakdown,
  extractExclusiveFromInclusive,
  getEffectiveTaxRate,
  minorUnitsPerUnit,
  taxSettingsToConfig,
  type TaxBreakdownCalculation,
  type TaxConfig,
} from "@louez/utils";

/**
 * The tax engine over a reservation's lines, as the checkout computes it
 * (M1): per-line rates, the inclusion mode, insurance exempt from tax, the
 * delivery fee and the discount's allocation. Pure, with no runtime import
 * but `@louez/utils`: the dashboard's edit form computes its preview with it.
 */

/** A line as the tax engine reads it. */
export interface TaxedLine {
  /** The line's amount, as stored on the reservation. */
  subtotal: number;
  /** Its price per unit, from which its price before tax is derived. */
  unitPrice: number;
  /** The product's own rate, or null for the store's. */
  taxSettings: ProductTaxSettings | null;
  /** A promoted line takes no share of the discount. */
  promotion?: AppliedProductPromotion | null;
  /** Outside the tax by rule: no tax, whatever the rates. */
  taxExempt?: boolean;
}

export const INSURANCE_TAX_LINE_ID = "insurance";
export const DELIVERY_TAX_LINE_ID = "delivery";

export const getItemTaxLineId = (index: number): string => `item:${index}`;

export interface ReservationTotals {
  /** Line subtotal plus insurance: what the reservation row stores as subtotal. */
  subtotal: number;
  discount: number;
  deposit: number;
  deliveryFee: number;
  /** Amount charged (deposit excluded): the tax engine's total including tax. */
  total: number;
  taxConfig: TaxConfig | undefined;
  taxEnabled: boolean;
  taxRate: number | null;
  displayMode: "inclusive" | "exclusive";
  subtotalExclTax: number | null;
  taxAmount: number | null;
  taxCalculation: TaxBreakdownCalculation;
  taxByLineId: Map<string, TaxBreakdownCalculation["lines"][number]>;
  /** Minor units in one unit of the currency the totals are in: 1 for the yen, 100 for the euro. */
  minorUnitsPerUnit: number;
}

/**
 * Tax breakdown over the priced lines, the VAT-exempt insurance line, the
 * delivery fee and the promo discount. In TTC mode the engine only splits the
 * displayed cents; in HT mode it adds the exact per-line VAT.
 */
export const computeReservationTotals = <Line extends TaxedLine>({
  lines,
  insuranceAmount,
  discountAmount,
  deliveryFee,
  totalDeposit,
  taxSettings,
  currency,
}: {
  lines: readonly Line[];
  insuranceAmount: number;
  discountAmount: number;
  deliveryFee: number;
  totalDeposit: number;
  taxSettings: TaxSettings | undefined;
  /**
   * The reservation's currency: the tax, the discount and the totals are
   * allocated and rounded in its minor unit (¥1, 1 cent). Every writer passes
   * it; without one, cents.
   */
  currency?: string | null;
}): ReservationTotals => {
  const taxConfig = taxSettingsToConfig(taxSettings);
  const taxEnabled = taxConfig?.enabled ?? false;
  const storeTaxRate = taxConfig?.rate ?? 0;
  const displayMode = taxConfig?.displayMode ?? "inclusive";

  const taxableLines = lines.map((line, index) => ({
    id: getItemTaxLineId(index),
    amount: line.subtotal,
    taxRate: line.taxExempt ? null : getEffectiveTaxRate(taxConfig, line.taxSettings),
  }));
  if (insuranceAmount > 0) {
    // Insurance premiums are VAT-exempt (art. 261 C, 2° CGI); Tulip premiums
    // already include insurance tax (TCA), never VAT.
    taxableLines.push({ id: INSURANCE_TAX_LINE_ID, amount: insuranceAmount, taxRate: null });
  }

  const taxCalculation = calculateTaxBreakdown({
    lines: taxableLines,
    deliveryFee,
    discountAmount,
    discountableLineIds: lines.some((line) => line.promotion)
      ? lines.flatMap((line, index) => (line.promotion ? [] : [getItemTaxLineId(index)]))
      : undefined,
    depositAmount: totalDeposit,
    taxConfig,
    currency: currency ?? undefined,
  });

  const lineSubtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);

  return {
    subtotal: lineSubtotal + insuranceAmount,
    discount: discountAmount,
    deposit: totalDeposit,
    deliveryFee,
    total: taxCalculation.totalInclTax,
    taxConfig,
    taxEnabled,
    taxRate: taxEnabled ? storeTaxRate : null,
    displayMode,
    subtotalExclTax: taxEnabled ? taxCalculation.subtotalExclTax : null,
    taxAmount: taxEnabled ? taxCalculation.taxAmount : null,
    taxCalculation,
    taxByLineId: new Map(taxCalculation.lines.map((line) => [line.id, line])),
    minorUnitsPerUnit: minorUnitsPerUnit(currency ?? undefined),
  };
};

export interface ReservationItemTaxFields {
  taxRate: number | null;
  taxAmount: number | null;
  priceExclTax: number | null;
  totalExclTax: number | null;
}

/** Per-item tax columns of `reservation_items`, null when taxes are off. */
export const getReservationItemTaxFields = (
  totals: ReservationTotals,
  line: Pick<TaxedLine, "unitPrice">,
  index: number,
): ReservationItemTaxFields => {
  const itemTax = totals.taxByLineId.get(getItemTaxLineId(index));
  if (!totals.taxEnabled || !itemTax || itemTax.taxRate === null) {
    return { taxRate: null, taxAmount: null, priceExclTax: null, totalExclTax: null };
  }

  return {
    taxRate: itemTax.taxRate,
    taxAmount: itemTax.taxAmount,
    priceExclTax:
      totals.displayMode === "inclusive"
        ? extractExclusiveFromInclusive(line.unitPrice, itemTax.taxRate, totals.minorUnitsPerUnit)
        : line.unitPrice,
    totalExclTax: itemTax.amountExclTax,
  };
};
