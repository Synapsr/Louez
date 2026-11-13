import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The payments a store records by hand on a reservation: money received or
 * paid back, a deposit given back, a payment deleted. The `record_payment`,
 * `record_deposit_return` and `delete_payment` tools, and the in-app
 * assistant's. Stripe's payments, refunds and deposit holds are not here.
 */

export const RECORDED_PAYMENT_TYPES = [
  "rental",
  "deposit",
  "deposit_return",
  "damage",
  "adjustment",
] as const;
export const RECORDED_PAYMENT_METHODS = ["cash", "card", "transfer", "check", "other"] as const;

/** The tools' arguments as their agents knew them: the amount is a string, checked by the write. */
export const recordPaymentInput = z.object({
  reservationId: z.string().describe("The reservation ID"),
  type: z.enum(RECORDED_PAYMENT_TYPES).describe("Payment type"),
  amount: z.string().describe('Amount (e.g. "150.00")'),
  method: z.enum(RECORDED_PAYMENT_METHODS).describe("Payment method"),
  notes: z.string().optional().describe("Optional notes"),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentInput>;

export const recordDepositReturnInput = z.object({
  reservationId: z.string().describe("The reservation ID"),
  amount: z.string().describe("Amount given back"),
  method: z.enum(RECORDED_PAYMENT_METHODS).describe("How the deposit was given back"),
  notes: z.string().optional().describe("Optional notes"),
});
export type RecordDepositReturnInput = z.infer<typeof recordDepositReturnInput>;

export const deletePaymentInput = z.object({
  paymentId: z.string().describe("The payment ID to delete"),
});
export type DeletePaymentInput = z.infer<typeof deletePaymentInput>;

const reservationLinksField = resourceLinksSchema
  .optional()
  .describe(
    "The reservation's dashboard page, to give the user; absent when the caller may not read reservations.",
  );

export const recordPaymentOutput = z.object({
  reservationId: z.string(),
  number: z.string().describe("The reservation's number."),
  type: z.enum(RECORDED_PAYMENT_TYPES),
  amount: z.string().describe("The amount as recorded."),
  method: z.enum(RECORDED_PAYMENT_METHODS),
  links: reservationLinksField,
});
export type RecordPaymentOutput = z.infer<typeof recordPaymentOutput>;

export const recordDepositReturnOutput = z.object({
  reservationId: z.string(),
  number: z.string().describe("The reservation's number."),
  amount: z.string().describe("The amount given back, as recorded."),
  method: z.enum(RECORDED_PAYMENT_METHODS),
  links: reservationLinksField,
});
export type RecordDepositReturnOutput = z.infer<typeof recordDepositReturnOutput>;

export const deletePaymentOutput = z.object({
  paymentId: z.string(),
  reservationId: z.string(),
  number: z.string().describe("The reservation's number."),
  links: reservationLinksField,
});
export type DeletePaymentOutput = z.infer<typeof deletePaymentOutput>;

/** The deposit figures behind a refused return, as `0.00` strings. */
export interface DepositBalance {
  collected: string;
  returned: string;
  returnable: string;
}

/**
 * The refusals of the payment writes. Each keeps the message the hand-written
 * tools answered with; `money` writes the amounts as they did (`€25.00`).
 */
export const paymentRecordErrors = {
  reservationNotFound: (id: string) =>
    apiError("NOT_FOUND", "RESERVATION_NOT_FOUND", {
      message: "Reservation not found.",
      i18nKey: "errors.reservationNotFound",
      details: { id },
    }),
  paymentNotFound: (id: string) =>
    apiError("NOT_FOUND", "PAYMENT_NOT_FOUND", {
      message: "Payment not found.",
      details: { id },
    }),
  /** Not a number, or zero. */
  amountInvalid: () =>
    apiError("BAD_REQUEST", "PAYMENT_AMOUNT_INVALID", {
      message: "Amount must be a non-zero number.",
      i18nKey: "errors.invalidAmount",
    }),
  negativeOutsideAdjustment: () =>
    apiError("BAD_REQUEST", "PAYMENT_NEGATIVE_AMOUNT_NOT_ADJUSTMENT", {
      message: 'Only "adjustment" payments can have a negative amount.',
      i18nKey: "errors.negativeAmountOnlyForAdjustment",
    }),
  reservationClosed: (status: "cancelled" | "rejected") =>
    apiError("CONFLICT", "PAYMENT_RESERVATION_CLOSED", {
      message: `Cannot record payment on a ${status} reservation.`,
      details: { status },
    }),
  stripePaymentNotDeletable: () =>
    apiError("CONFLICT", "PAYMENT_STRIPE_NOT_DELETABLE", {
      message: "Cannot delete a Stripe payment. Use the Stripe dashboard for refunds.",
    }),
  /** Not a number, zero or below. */
  depositReturnAmountInvalid: () =>
    apiError("BAD_REQUEST", "DEPOSIT_RETURN_AMOUNT_INVALID", {
      message: "Amount must be greater than zero.",
      i18nKey: "errors.invalidAmount",
    }),
  depositReturnExceedsBalance: (balance: DepositBalance, money: (amount: string) => string) =>
    apiError("CONFLICT", "DEPOSIT_RETURN_EXCEEDS_BALANCE", {
      message:
        `Amount exceeds returnable deposit. ` +
        `Collected: ${money(balance.collected)}, ` +
        `already returned: ${money(balance.returned)}, ` +
        `max returnable: ${money(balance.returnable)}.`,
      details: { ...balance },
    }),
};
