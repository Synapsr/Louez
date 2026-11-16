import { computeReservationTotals } from "@louez/api/services/reservation-totals";
import type { ProductTaxSettings, TaxSettings } from "@louez/types";
import { roundToMinorUnit } from "@louez/utils";

/**
 * The totals the dashboard's creation will write (slice 10): the tax engine
 * over the product lines (each at its product's rate) and the custom lines
 * (at the store's), the insurance (exempt), the delivery fee and the
 * discount, with the same function and the same inputs as the server
 * (`createManualReservation`).
 */
export function creationTotals(input: {
  productLines: ReadonlyArray<{ amount: number; taxSettings: ProductTaxSettings | null }>;
  customLines: ReadonlyArray<{ amount: number }>;
  insuranceAmount: number;
  deliveryFee: number;
  discountAmount: number;
  deposit: number;
  taxSettings: TaxSettings | undefined;
  currency: string | undefined;
}) {
  return computeReservationTotals({
    lines: [
      ...input.productLines.map((line) => ({
        // Each line rounded as the server rounds the amount it writes.
        subtotal: roundToMinorUnit(line.amount, input.currency),
        unitPrice: roundToMinorUnit(line.amount, input.currency),
        taxSettings: line.taxSettings,
      })),
      ...input.customLines.map((line) => ({
        subtotal: roundToMinorUnit(line.amount, input.currency),
        unitPrice: roundToMinorUnit(line.amount, input.currency),
        taxSettings: null,
      })),
    ],
    insuranceAmount: input.insuranceAmount,
    discountAmount: input.discountAmount,
    deliveryFee: input.deliveryFee,
    totalDeposit: input.deposit,
    taxSettings: input.taxSettings,
    currency: input.currency,
  });
}
