import { eq } from "drizzle-orm";

import { stores, type Transaction } from "@louez/db";
import type { StoreSettings } from "@louez/types";

import {
  applyRecordedPromotion,
  editedLineTaxSettings,
  type EditedLineTax,
} from "./edit-line-pricing";
import { loadPricingCatalog, priceRegularCatalogLine } from "./pricing-catalog";
import { taxDisplayModeOf, taxSettingsForRepricing, type TaxDisplayMode } from "./pricing-facts";
import {
  computeReservationTotals,
  getReservationItemTaxFields,
  INSURANCE_TAX_LINE_ID,
  type ReservationItemTaxFields,
  type ReservationTotals,
  type TaxedLine,
} from "./reservation-totals";

/**
 * The totals of a reservation the store edits from the dashboard
 * (`updateReservation`), computed under its locks (docs/domain/reservation-changes.md,
 * slice 10; M1): the tax engine over its lines, its insurance (exempt), its
 * delivery fee and its discount, exactly as the checkout computes them, in
 * the display mode the reservation recorded.
 *
 * A line's amount is the one the edit computed for it before its locks
 * (`priceEditedProductLine`, slice 11): a line the edit does not change keeps
 * its stored price and its recorded rate. A line priced from its product is
 * priced again here, from the catalogue read under the locks: when that no
 * longer gives the same amount to the cent, the product changed while the
 * store was editing, and the edit is refused.
 */

const cents = (value: number) => Math.round(value * 100);

/** A line of the reservation as the edit leaves it. */
export interface EditedLine {
  /** The product it was priced from by today's rules; null for a price typed by hand, a custom line or a product gone. */
  pricedFromProductId: string | null;
  productId: string | null;
  quantity: number;
  /** Its amount, as it will be stored. */
  subtotal: number;
  unitPrice: number;
  /** The exemption it recorded; null when it recorded none. */
  taxExempt: boolean | null;
  /** The tax it is priced with (slice 11): a rate it keeps, or today's settings. */
  tax: EditedLineTax;
  /** The percentage of the promotion it recorded, applied again to its new price (slice 11). */
  promotionPercentage: number | null;
}

export interface EditPricingInput {
  storeId: string;
  window: { start: Date; end: Date };
  lines: readonly EditedLine[];
  /** The insurance premium, exempt from tax; 0 for none. */
  insuranceAmount: number;
  discountAmount: number;
  totalDeposit: number;
  /** The stored fee, or the fee of the new delivery from the subtotal and the store's settings read under the locks. */
  deliveryFee: number | ((subtotal: number, settings: StoreSettings | null) => number);
  /** The display mode the reservation recorded, null when it recorded none. */
  recordedTaxDisplayMode: TaxDisplayMode | null;
  /** The reservation's currency: the tax and the totals in its minor unit. */
  currency: string;
}

export type EditPricing =
  | { ok: false }
  | {
      ok: true;
      totals: ReservationTotals;
      deliveryFee: number;
      /** What the reservation records: the mode it recorded, or the store's today. */
      taxDisplayMode: TaxDisplayMode;
      /** Each line's tax figures, in the order of `lines`, and the exemption it records. */
      lines: Array<ReservationItemTaxFields & { taxExempt: boolean }>;
      /** The insurance line's tax figures (no rate: it is exempt). */
      insurance: ReservationItemTaxFields;
    };

/**
 * Prices an edit under the locks. Reads the store's settings and the lines'
 * products in `tx`; `{ ok: false }` when a line priced from its product no
 * longer gets the amount the edit computed (the product, its tiers or its
 * seasons changed meanwhile, or it is gone).
 */
export async function priceReservationEdit(
  tx: Transaction,
  input: EditPricingInput,
): Promise<EditPricing> {
  const [store] = await tx
    .select({ settings: stores.settings })
    .from(stores)
    .where(eq(stores.id, input.storeId));
  const settings = store?.settings ?? null;
  const catalog = await loadPricingCatalog(tx, {
    storeId: input.storeId,
    productIds: input.lines.flatMap((line) => (line.productId ? [line.productId] : [])),
    timezone: settings?.timezone,
    includeInactive: true,
  });

  for (const line of input.lines) {
    if (!line.pricedFromProductId) continue;
    const product = catalog.get(line.pricedFromProductId);
    if (!product) return { ok: false };
    const priced = priceRegularCatalogLine(product, {
      productId: product.id,
      quantity: line.quantity,
      startDate: input.window.start.toISOString(),
      endDate: input.window.end.toISOString(),
    });
    const subtotal =
      line.promotionPercentage === null
        ? priced.subtotal
        : applyRecordedPromotion(priced.subtotal, { percentage: line.promotionPercentage })
            .subtotal;
    if (cents(subtotal) !== cents(line.subtotal)) return { ok: false };
  }

  const taxed: TaxedLine[] = input.lines.map((line) => ({
    subtotal: line.subtotal,
    unitPrice: line.unitPrice,
    taxSettings: editedLineTaxSettings(
      line.tax,
      line.productId ? catalog.get(line.productId)?.taxSettings : null,
    ),
    // A line not outside the tax by rule: a product or a custom line.
    taxExempt: line.taxExempt ?? false,
  }));
  const subtotal =
    cents(taxed.reduce((sum, line) => sum + line.subtotal, 0) + input.insuranceAmount) / 100;
  const deliveryFee =
    typeof input.deliveryFee === "number"
      ? input.deliveryFee
      : input.deliveryFee(subtotal, settings);
  const totals = computeReservationTotals({
    lines: taxed,
    insuranceAmount: input.insuranceAmount,
    discountAmount: input.discountAmount,
    deliveryFee,
    totalDeposit: input.totalDeposit,
    taxSettings: taxSettingsForRepricing(settings?.tax, input.recordedTaxDisplayMode),
    currency: input.currency,
  });
  const insuranceTax = totals.taxEnabled
    ? totals.taxByLineId.get(INSURANCE_TAX_LINE_ID)
    : undefined;

  return {
    ok: true,
    totals,
    deliveryFee,
    taxDisplayMode: input.recordedTaxDisplayMode ?? taxDisplayModeOf(settings?.tax),
    lines: taxed.map((line, index) => ({
      ...getReservationItemTaxFields(totals, line, index),
      taxExempt: line.taxExempt ?? false,
    })),
    insurance: {
      taxRate: null,
      taxAmount: insuranceTax?.taxAmount ?? null,
      priceExclTax: insuranceTax?.amountExclTax ?? null,
      totalExclTax: insuranceTax?.amountExclTax ?? null,
    },
  };
}
