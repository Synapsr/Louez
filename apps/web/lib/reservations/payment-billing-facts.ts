import type { StoreSettings } from "@louez/types";

import {
  insuranceShare,
  normalizeCurrency,
  reservationTotalsMinor,
  toMinor,
  type ReservationTotalsInput,
} from "@/lib/billing-sync/money";

// The billing facts written with a payment row the dashboard creates
// (louez-billing docs/api: README Q3, Q4, Q7; fees.md §3, §4). They are set once,
// with the row: refunds net `amount`, never these.

export type RecordedPaymentType = "rental" | "deposit" | "deposit_return" | "damage" | "adjustment";

/** The reservation's currency: frozen at creation, else the store's (contract Q4). */
export function reservationCurrency(
  currency: string | null,
  storeSettings: Pick<StoreSettings, "currency"> | null,
): string {
  return normalizeCurrency(currency ?? storeSettings?.currency);
}

/**
 * A stored `decimal(10,2)` amount in minor units. Null for a currency the contract
 * does not support (three decimals): the payment is still recorded, and the
 * heartbeat reports it.
 */
export function grossMinorOf(amount: string, currency: string): number | null {
  const result = toMinor(amount, currency);
  return "minor" in result ? result.minor : null;
}

export type RecordedPaymentFacts = {
  readonly currency: string;
  readonly grossMinor: number | null;
  readonly insuranceShareMinor: number | null;
};

/**
 * Facts of a payment the store records by hand. Only a rental payment carries an
 * insurance share, read from the reservation's totals at the time it is recorded
 * (fees.md §4); `totals.items` is read for rentals only.
 */
export function recordedPaymentFacts(input: {
  readonly type: RecordedPaymentType;
  readonly amount: string;
  readonly totals: ReservationTotalsInput;
}): RecordedPaymentFacts {
  const currency = reservationCurrency(
    input.totals.reservation.currency,
    input.totals.storeSettings,
  );
  const grossMinor = grossMinorOf(input.amount, currency);
  if (input.type !== "rental") return { currency, grossMinor, insuranceShareMinor: 0 };
  if (grossMinor === null) return { currency, grossMinor, insuranceShareMinor: null };

  const { insuranceMinor, totalInclTaxMinor } = reservationTotalsMinor(input.totals);
  return {
    currency,
    grossMinor,
    insuranceShareMinor: insuranceShare({ insuranceMinor, grossMinor, totalInclTaxMinor }),
  };
}
