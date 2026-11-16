import {
  priceCatalogLine,
  type PricedCatalogLine,
  type PricingCatalog,
  type PricingCatalogLineInput,
  type PricingCatalogProduct,
} from "./pricing-catalog";
import type { PricingBreakdown, ProductTaxSettings } from "@louez/types";
import type { ReservationItemTaxFields } from "./reservation-totals";

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

export {
  computeReservationTotals,
  DELIVERY_TAX_LINE_ID,
  getItemTaxLineId,
  getReservationItemTaxFields,
  INSURANCE_TAX_LINE_ID,
  type ReservationItemTaxFields,
  type ReservationTotals,
  type TaxedLine,
} from "./reservation-totals";

/**
 * The checkout's pricing breakdown of a line, written on every line it
 * prices (slice 9): the promotion its price applied, `null` when none did,
 * and the tax figures. The checkout and the API's creation write the same.
 */
export const checkoutLineBreakdown = (
  product: Pick<PricingCatalogProduct, "price" | "pricingMode"> | undefined,
  line: PricedCartLine,
  tax: ReservationItemTaxFields,
): PricingBreakdown => ({
  basePrice: product?.price ?? line.unitPrice,
  effectivePrice: line.unitPrice,
  duration: line.duration,
  pricingMode: product?.pricingMode ?? "day",
  pricingKind: line.pricingKind,
  discountPercent: line.promotion?.percentage ?? null,
  discountAmount: line.promotion?.discountAmount ?? 0,
  tierApplied: null,
  promotion: line.promotion ?? null,
  taxRate: tax.taxRate,
  taxAmount: tax.taxAmount,
  subtotalExclTax: tax.totalExclTax,
  subtotalInclTax:
    tax.totalExclTax !== null && tax.taxAmount !== null
      ? tax.totalExclTax + tax.taxAmount
      : line.subtotal,
  // An unpromoted line kept no breakdown before: this one records its facts only.
  ...(line.promotion ? {} : { factsOnly: true as const }),
});
