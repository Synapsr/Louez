import { getRentalPaid, type SettledPaymentRow } from "@louez/utils";

/** An amount in whole hundredths; a value that is not a finite number reads as nothing. */
const toHundredths = (value: string | number | null | undefined): number => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

/**
 * What a reservation's rental costs: its stored total, tax included. A total
 * never contains the deposit (migration 0108 made the older rows fit). Zero is
 * a valid total, a discount that covers the rental; a negative or non-finite
 * value owes nothing.
 */
export function getReservationRentalAmount(reservation: {
  readonly totalAmount: string | number | null;
}): number {
  return Math.max(0, toHundredths(reservation.totalAmount)) / 100;
}

/**
 * What is still owed for the rental: its total less what settles it
 * (`getRentalPaid`, in the reservation's currency), counted in whole
 * hundredths, never below zero. The one reading of the payment request,
 * the reservation's page and payment section, the reservation list and the
 * payment recorded by hand.
 */
export function getRentalRemaining(
  reservation: { readonly totalAmount: string | number | null },
  rentalPaid: number,
): number {
  const total = Math.max(0, toHundredths(reservation.totalAmount));
  return Math.max(0, total - toHundredths(rentalPaid)) / 100;
}

/**
 * Where the customer stands on the rental, in the reservation's currency:
 * `paid`, what settles it (`getRentalPaid`), and `due`, what is still owed
 * (`getRentalRemaining`). The rental is settled when `due` is zero, overpaid
 * included. The one reading of every customer-facing "paid": the account
 * list and page, their pay button, the customer's payment session and the
 * store's payment request.
 */
export function getRentalBalance(
  reservation: {
    readonly totalAmount: string | number | null;
    readonly payments: readonly SettledPaymentRow[];
  },
  currency: string,
): { paid: number; due: number } {
  const paid = getRentalPaid(reservation.payments, currency);
  return { paid, due: getRentalRemaining(reservation, paid) };
}

/**
 * What was paid for the rental beyond its total: what settles it
 * (`getRentalPaid`) less the total, in whole hundredths, never below zero. The
 * other side of `getRentalRemaining`: at most one of the two is above zero.
 */
export function getRentalOverpaid(
  reservation: { readonly totalAmount: string | number | null },
  rentalPaid: number,
): number {
  const total = Math.max(0, toHundredths(reservation.totalAmount));
  return Math.max(0, toHundredths(rentalPaid) - total) / 100;
}
