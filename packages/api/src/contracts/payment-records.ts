import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The payments a store records by hand on a reservation: money received or
 * paid back, a deposit given back, a refund given by hand, a payment
 * deleted. The `record_payment`, `record_deposit_return`, `record_refund`
 * and `delete_payment` tools, and the in-app assistant's. Stripe's
 * payments, refunds and deposit holds are not here.
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

export const recordRefundInput = z.object({
  paymentId: z.string().describe("The ID of the payment the store refunded"),
  amount: z.string().describe('Amount given back, in the payment\'s own currency (e.g. "30.00")'),
  method: z.enum(RECORDED_PAYMENT_METHODS).describe("How the money was given back"),
  notes: z.string().optional().describe("Optional notes"),
});
export type RecordRefundInput = z.infer<typeof recordRefundInput>;

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

/** Where a refund's credit note stands in the answer. */
export const REFUND_CREDIT_NOTE_STATUSES = ["issued", "pending", "not_applicable"] as const;
export type RefundCreditNoteStatus = (typeof REFUND_CREDIT_NOTE_STATUSES)[number];

export const recordRefundOutput = z.object({
  refundId: z.string().describe("The ID of the refund's own payment row."),
  paymentId: z.string().describe("The payment refunded."),
  reservationId: z.string(),
  number: z.string().describe("The reservation's number."),
  amount: z.string().describe("The amount given back, as recorded."),
  currency: z.string().describe("The currency of the payment refunded, which the refund takes."),
  method: z.enum(RECORDED_PAYMENT_METHODS),
  creditNote: z
    .object({
      status: z
        .enum(REFUND_CREDIT_NOTE_STATUSES)
        .describe(
          "`issued`: the credit note exists. `pending`: it is owed and not issued yet; Louez issues it, retrying on its own. `not_applicable`: the store issues no invoices, or the payment refunded has none, so there is nothing to issue.",
        ),
      number: z
        .string()
        .nullable()
        .describe("The credit note's number once issued; null otherwise."),
    })
    .describe("The refund's credit note. The refund stands whatever its status."),
  links: reservationLinksField,
});
export type RecordRefundOutput = z.infer<typeof recordRefundOutput>;

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

/** The figures behind a refused refund, as `0.00` strings, in the payment's currency. */
export interface RefundBalance {
  paid: string;
  refunded: string;
  refundable: string;
  currency: string;
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
  /** Not a plain decimal of at most 8 digits before the point and 2 after, or zero (`paymentAmount`). */
  amountInvalid: () =>
    apiError("BAD_REQUEST", "PAYMENT_AMOUNT_INVALID", {
      message:
        'Amount must be a plain decimal, not zero, with at most 8 digits before the point and 2 after (such as "150" or "-20.50").',
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
  /** Not a plain decimal of at most 8 digits before the point and 2 after, or zero and below (`paymentAmount`). */
  depositReturnAmountInvalid: () =>
    apiError("BAD_REQUEST", "DEPOSIT_RETURN_AMOUNT_INVALID", {
      message:
        'Amount must be a plain decimal above zero, with at most 8 digits before the point and 2 after (such as "150.00").',
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
  /** Not a plain decimal of at most 8 digits before the point and 2 after, or zero and below (`paymentAmount`). */
  refundAmountInvalid: () =>
    apiError("BAD_REQUEST", "REFUND_AMOUNT_INVALID", {
      message:
        'Amount must be a plain decimal above zero, with at most 8 digits before the point and 2 after (such as "30.00").',
      i18nKey: "errors.invalidAmount",
    }),
  /** A non-zero digit past the minor unit of the payment's currency (no decimals in yen, two in euros). */
  refundAmountTooPrecise: (currency: string, decimals: number) =>
    apiError("BAD_REQUEST", "REFUND_AMOUNT_INVALID", {
      message:
        decimals === 0
          ? `A ${currency} amount has no decimals: send whole units (such as "30").`
          : `A ${currency} amount has at most ${decimals} decimals.`,
      i18nKey: "errors.invalidAmount",
      details: { currency, decimals },
    }),
  /** A three-decimal currency: Louez's billing does not carry it. */
  refundCurrencyNotSupported: (currency: string) =>
    apiError("CONFLICT", "REFUND_CURRENCY_NOT_SUPPORTED", {
      message: `This payment is in ${currency}, a three-decimal currency Louez's billing does not count: a refund of it cannot be recorded.`,
      details: { currency },
    }),
  /** A refund's own row: a refund is recorded against the payment it gives back. */
  refundOfRefund: () =>
    apiError("CONFLICT", "REFUND_OF_REFUND", {
      message:
        "This payment is itself a refund: record the refund against the payment it gives back.",
    }),
  refundTypeNotRefundable: (type: string) =>
    apiError("CONFLICT", "REFUND_PAYMENT_TYPE_NOT_REFUNDABLE", {
      message: `A ${type} payment cannot be refunded: only rental, damage, adjustment and kept deposit (deposit_capture) payments can. A deposit given back is recorded as a deposit return instead.`,
      details: { type },
    }),
  refundPaymentNotCompleted: (status: string) =>
    apiError("CONFLICT", "REFUND_PAYMENT_NOT_COMPLETED", {
      message: `Only a completed payment can be refunded; this one is ${status}.`,
      details: { status },
    }),
  refundStripePayment: () =>
    apiError("CONFLICT", "REFUND_STRIPE_PAYMENT", {
      message:
        "This payment was taken online through Stripe. Refunds of online payments are not available through this action yet: it records only refunds of payments the store took by hand.",
    }),
  /** A payment of zero or below: money paid back, with nothing received to refund. */
  refundPaymentNotReceived: () =>
    apiError("CONFLICT", "REFUND_PAYMENT_NOT_RECEIVED", {
      message: "This payment records no money received: there is nothing to refund.",
    }),
  /** `money` writes an amount in the payment's currency (`£20.00`). */
  refundExceedsRefundable: (balance: RefundBalance, money: (amount: string) => string) =>
    apiError("CONFLICT", "REFUND_EXCEEDS_REFUNDABLE", {
      message:
        `Amount exceeds what is left to refund on this payment. ` +
        `Paid: ${money(balance.paid)}, ` +
        `already refunded: ${money(balance.refunded)}, ` +
        `refundable: ${money(balance.refundable)}.`,
      details: { ...balance },
    }),
};
