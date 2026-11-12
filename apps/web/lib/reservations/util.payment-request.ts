import type { StoreSettings } from "@louez/types";

import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { type PaymentLike, getRentalPaid } from "@/lib/reservations/util.payment-status";

/**
 * What a reservation's rental costs, without its deposit: its total, less the
 * deposit when the total includes it.
 */
export function getReservationRentalAmount(reservation: {
  subtotalAmount: string;
  depositAmount: string;
  totalAmount: string;
}) {
  const subtotal = parseFloat(reservation.subtotalAmount || "0");
  const deposit = parseFloat(reservation.depositAmount || "0");
  const total = parseFloat(reservation.totalAmount || "0");

  if (!Number.isFinite(total) || total <= 0) return subtotal;
  if (deposit > 0 && total - subtotal >= deposit - 0.01) {
    return Math.max(0, total - deposit);
  }

  return total;
}

export type PaymentRequestTerms =
  | {
      readonly ok: true;
      readonly amount: number;
      readonly description: string;
      readonly currency: string;
    }
  | {
      readonly ok: false;
      readonly error: "errors.invalidAmount" | "errors.noAmountDue" | "errors.noDepositRequired";
    };

/**
 * What the store asks its customer to pay on a reservation: the rental still due,
 * the deposit, or an amount of its choice. It is owed in the reservation's currency,
 * frozen when the reservation was made, whatever the store's is now.
 */
export function paymentRequestTerms(input: {
  readonly type: "rental" | "deposit" | "custom";
  /** The amount of a `custom` request. */
  readonly customAmount?: number;
  readonly reservation: {
    readonly currency: string | null;
    readonly subtotalAmount: string;
    readonly depositAmount: string;
    readonly totalAmount: string;
    readonly payments: readonly PaymentLike[];
  };
  readonly storeSettings: Pick<StoreSettings, "currency"> | null;
}): PaymentRequestTerms {
  const { reservation } = input;
  const currency = reservationCurrency(reservation.currency, input.storeSettings);

  if (input.type === "custom") {
    if (!input.customAmount || input.customAmount < 0.5) {
      return { ok: false, error: "errors.invalidAmount" };
    }
    return { ok: true, amount: input.customAmount, description: "Payment", currency };
  }

  if (input.type === "rental") {
    // What was received in the reservation's currency: a payment in another one does
    // not reduce what is owed (invariant M6).
    const amount =
      getReservationRentalAmount(reservation) - getRentalPaid(reservation.payments, currency);
    if (amount < 0.5) return { ok: false, error: "errors.noAmountDue" };
    return { ok: true, amount, description: "Rental", currency };
  }

  const amount = parseFloat(reservation.depositAmount || "0");
  if (amount < 0.5) return { ok: false, error: "errors.noDepositRequired" };
  return { ok: true, amount, description: "Deposit", currency };
}
