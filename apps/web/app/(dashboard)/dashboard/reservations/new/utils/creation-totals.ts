import {
  computeReservationTotals,
  type ReservationTotals,
  type TaxedLine,
} from "@louez/api/services/reservation-totals";
import type { ProductTaxSettings, TaxSettings } from "@louez/types";
import { roundToMinorUnit } from "@louez/utils";

/**
 * The totals the dashboard's creation writes (slice 10), computed by this one
 * function for the server (`createManualReservation`) and for the form that
 * shows them: the tax engine over the product lines (each at its product's
 * rate) and the custom lines (at the store's), the insurance (exempt), the
 * delivery fee and the discount.
 *
 * A line priced from the catalogue enters as its pricing gave it, to the
 * cent, as the checkout gives it to the engine; a price typed by hand and a
 * custom line are rounded once to the currency's minor unit, as they are
 * written. `taxedLines` are the lines as the engine took them, in order:
 * the product lines, then the custom lines.
 */
export function creationTotals(input: {
  productLines: ReadonlyArray<{
    subtotal: number;
    unitPrice: number;
    /** A price typed by hand: rounded to the minor unit. */
    typed: boolean;
    taxSettings: ProductTaxSettings | null;
  }>;
  customLines: ReadonlyArray<{ subtotal: number; unitPrice: number }>;
  insuranceAmount: number;
  deliveryFee: number;
  discountAmount: number;
  deposit: number;
  taxSettings: TaxSettings | undefined;
  currency: string | undefined;
}): ReservationTotals & { taxedLines: TaxedLine[] } {
  const rounded = (value: number) => roundToMinorUnit(value, input.currency);
  const taxedLines: TaxedLine[] = [
    ...input.productLines.map((line) =>
      line.typed
        ? {
            subtotal: rounded(line.subtotal),
            unitPrice: rounded(line.unitPrice),
            taxSettings: line.taxSettings,
          }
        : { subtotal: line.subtotal, unitPrice: line.unitPrice, taxSettings: line.taxSettings },
    ),
    ...input.customLines.map((line) => ({
      subtotal: rounded(line.subtotal),
      unitPrice: rounded(line.unitPrice),
      taxSettings: null,
    })),
  ];
  return {
    ...computeReservationTotals({
      lines: taxedLines,
      insuranceAmount: input.insuranceAmount,
      discountAmount: input.discountAmount,
      deliveryFee: input.deliveryFee,
      totalDeposit: input.deposit,
      taxSettings: input.taxSettings,
      currency: input.currency,
    }),
    taxedLines,
  };
}
