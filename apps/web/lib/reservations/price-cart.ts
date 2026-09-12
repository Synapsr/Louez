import {
  priceCatalogLine,
  type PricedCatalogLine,
  type PricingCatalog,
  type PricingCatalogLineInput,
} from "@louez/api/services/pricing-catalog";
import type { ProductTaxSettings, TaxSettings } from "@louez/types";
import {
  calculateTaxBreakdown,
  extractExclusiveFromInclusive,
  getEffectiveTaxRate,
  taxSettingsToConfig,
  type TaxBreakdownCalculation,
  type TaxConfig,
} from "@louez/utils";

export interface PricedCartLine extends PricedCatalogLine {
  /** Product name from the catalog, used in stock and Stripe messages. */
  productName: string;
  taxSettings: ProductTaxSettings | null;
}

export interface PricedCart {
  lines: PricedCartLine[];
  /** Sum of the line subtotals (insurance and delivery excluded). */
  subtotal: number;
  totalDeposit: number;
}

export type PriceCartResult =
  | { ok: true; cart: PricedCart }
  | { ok: false; missingProductId: string };

/** Price every line from the batch catalog; the first unknown product aborts. */
export const priceCart = ({
  catalog,
  lines,
  now = new Date(),
}: {
  catalog: PricingCatalog;
  lines: PricingCatalogLineInput[];
  now?: Date;
}): PriceCartResult => {
  const pricedLines: PricedCartLine[] = [];
  let subtotal = 0;
  let totalDeposit = 0;

  for (const line of lines) {
    const product = catalog.get(line.productId);
    if (!product) {
      return { ok: false, missingProductId: line.productId };
    }

    const priced = priceCatalogLine(product, line, now);
    pricedLines.push({ ...priced, productName: product.name, taxSettings: product.taxSettings });
    subtotal += priced.subtotal;
    totalDeposit += priced.totalDeposit;
  }

  return { ok: true, cart: { lines: pricedLines, subtotal, totalDeposit } };
};

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
}

/**
 * Tax breakdown over the priced lines, the VAT-exempt insurance line, the
 * delivery fee and the promo discount. In TTC mode the engine only splits the
 * displayed cents; in HT mode it adds the exact per-line VAT.
 */
export const computeReservationTotals = ({
  lines,
  insuranceAmount,
  discountAmount,
  deliveryFee,
  totalDeposit,
  taxSettings,
}: {
  lines: PricedCartLine[];
  insuranceAmount: number;
  discountAmount: number;
  deliveryFee: number;
  totalDeposit: number;
  taxSettings: TaxSettings | undefined;
}): ReservationTotals => {
  const taxConfig = taxSettingsToConfig(taxSettings);
  const taxEnabled = taxConfig?.enabled ?? false;
  const storeTaxRate = taxConfig?.rate ?? 0;
  const displayMode = taxConfig?.displayMode ?? "inclusive";

  const taxableLines = lines.map((line, index) => ({
    id: getItemTaxLineId(index),
    amount: line.subtotal,
    taxRate: getEffectiveTaxRate(taxConfig, line.taxSettings),
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
  line: PricedCartLine,
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
        ? extractExclusiveFromInclusive(line.unitPrice, itemTax.taxRate)
        : line.unitPrice,
    totalExclTax: itemTax.amountExclTax,
  };
};
