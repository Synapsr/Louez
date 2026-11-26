import { getRentalPaid, roundDownToMinorUnit, type SettledPaymentRow } from "@louez/utils";

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
 * What can still be asked for the rental: its total less what settles it
 * (`getRentalPaid`, in the reservation's `currency`), counted in whole
 * hundredths, never below zero, then rounded down to the currency's minor
 * unit (`roundDownToMinorUnit`): a leftover below it (¥0.60) is settled, and
 * no charge of it takes more than is owed. The one reading of the customer's
 * account and payment session, the payment request, the reservation's page
 * and payment section, the reservation list, the edit and the payment
 * recorded by hand; the upcoming revenue applies it in SQL.
 */
export function getRentalRemaining(
  reservation: { readonly totalAmount: string | number | null },
  rentalPaid: number,
  currency: string,
): number {
  const total = Math.max(0, toHundredths(reservation.totalAmount));
  return roundDownToMinorUnit(Math.max(0, total - toHundredths(rentalPaid)) / 100, currency);
}

/**
 * Where the customer stands on the rental, in the reservation's currency:
 * `paid`, what settles it (`getRentalPaid`), and `due`, what can still be
 * asked of them (`getRentalRemaining`). The rental is settled when `due` is
 * zero, overpaid included. The one reading of every customer-facing "paid":
 * the account list and page, their pay button, the checkout's interrupted
 * page, the customer's payment session and the store's payment request.
 */
export function getRentalBalance(
  reservation: {
    readonly totalAmount: string | number | null;
    readonly payments: readonly SettledPaymentRow[];
  },
  currency: string,
): { paid: number; due: number } {
  const paid = getRentalPaid(reservation.payments, currency);
  return { paid, due: getRentalRemaining(reservation, paid, currency) };
}

/**
 * Why a rental session charging `charge.amount` cannot be opened on this
 * balance (`getRentalBalance`); null when it can. Nothing remains:
 * `errors.alreadyPaid`, and only then. A charge of what remains must be
 * exactly what remains; a checkout's own charge (`fixed`: a partial deposit or
 * the total, the rental's first payment) never more than remains, and only
 * while nothing is paid. Otherwise the reservation changed since the charge
 * was set (a payment landed, its total moved): nothing is charged, and a
 * reload reads the balance again. Amounts are compared in the currency's
 * minor unit, the charge rounded down to it as Stripe takes it.
 */
export function rentalChargeRefusal(
  balance: { readonly paid: number; readonly due: number },
  charge: { readonly amount: number; readonly fixed: boolean },
  currency: string,
): "errors.alreadyPaid" | "errors.reservationChangedMeanwhile" | null {
  if (balance.due === 0) return "errors.alreadyPaid";
  const charged = toHundredths(roundDownToMinorUnit(charge.amount, currency));
  const due = toHundredths(balance.due);
  const changed = charge.fixed ? balance.paid > 0 || charged > due : charged !== due;
  return changed ? "errors.reservationChangedMeanwhile" : null;
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
