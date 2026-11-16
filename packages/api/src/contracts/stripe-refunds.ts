import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The refund of a payment taken online, back to the means that paid it, through Stripe
 * (`refund_payment`, `get_refund`; services/stripe-refunds.ts). One refund is one
 * durable operation; its outcome can always be read.
 */

export const STRIPE_REFUND_REASONS = ["requested_by_customer", "duplicate"] as const;

export const refundPaymentInput = z
  .object({
    paymentId: z.string().describe("The ID of the payment taken online to refund"),
    amount: z
      .string()
      .describe(
        'Amount to give back, in the payment\'s own currency, with at most its decimals (e.g. "45.00"; whole units in yen)',
      ),
    reason: z
      .enum(STRIPE_REFUND_REASONS)
      .optional()
      .describe("Why it is refunded, as Stripe records it (default requested_by_customer)"),
    notes: z.string().max(1000).optional().describe("Optional notes, kept on the refund"),
  })
  .strict();
export type RefundPaymentInput = z.infer<typeof refundPaymentInput>;

export const getRefundInput = z
  .object({
    paymentId: z.string().describe("The ID of the payment refunded"),
    refundId: z.string().describe("The refund's ID (`refund.id`), as the refund's answer gave it"),
  })
  .strict();
export type GetRefundInput = z.infer<typeof getRefundInput>;

export const STRIPE_REFUND_STATUSES = ["pending", "succeeded", "failed"] as const;

export const refundPaymentOutput = z.object({
  refund: z.object({
    id: z.string().describe("The refund's ID, to read the refund again by."),
    status: z
      .enum(STRIPE_REFUND_STATUSES)
      .describe(
        "`pending`: Stripe has not given the outcome yet. `succeeded`: Stripe made the refund. `failed`: Stripe made none (see `failure`).",
      ),
    detail: z
      .enum(["sending", "awaiting_provider"])
      .nullable()
      .describe(
        "While pending: `sending` while Louez may still send it to Stripe, `awaiting_provider` once only Stripe's own account of the charge settles it. Null otherwise.",
      ),
    amount: z.string().describe("The amount given back, in the payment's currency."),
    currency: z.string(),
    reason: z.string(),
    createdAt: z.string().describe("When it was asked (ISO 8601)."),
    stripeRefundId: z.string().nullable(),
    refundPaymentId: z
      .string()
      .nullable()
      .describe(
        "The refund's own payment row, once Stripe made it; kept when the refund failed afterwards (the row is then failed).",
      ),
    failure: z
      .object({ code: z.string(), message: z.string().nullable() })
      .nullable()
      .describe("Why Stripe made no refund, when failed."),
    creditNote: z.object({
      status: z
        .enum(["issued", "pending", "not_applicable"])
        .describe(
          "`issued` with its number; `pending` while owed (Louez issues it, retrying on its own); `not_applicable` when there is none to issue.",
        ),
      number: z.string().nullable(),
      needsCorrection: z
        .boolean()
        .describe(
          "True when the refund failed after its credit note was issued: the note stands (Louez issues no document that cancels one) and the store corrects it in its accounting; its inbox shows it.",
        ),
    }),
  }),
  paymentId: z.string(),
  reservationId: z.string(),
  number: z.string().describe("The reservation's number."),
  links: resourceLinksSchema
    .optional()
    .describe(
      "The reservation's dashboard page, to give the user; absent when the caller may not read reservations.",
    ),
});
export type RefundPaymentOutput = z.infer<typeof refundPaymentOutput>;

/** What is left to refund, in the payment's currency, as decimal strings. */
export interface OnlineRefundBalance {
  paid: string;
  refunded: string;
  inFlight: string;
  refundable: string;
  currency: string;
}

export const stripeRefundErrors = {
  paymentNotFound: (paymentId: string) =>
    apiError("NOT_FOUND", "PAYMENT_NOT_FOUND", {
      message: `Payment ${paymentId} not found.`,
      details: { paymentId },
    }),
  refundNotFound: (refundId: string) =>
    apiError("NOT_FOUND", "REFUND_NOT_FOUND", {
      message: `Refund ${refundId} not found on this payment. A refund made outside Louez (in Stripe's own dashboard) has no refund here: it shows among the reservation's payments.`,
      details: { refundId },
    }),
  amountInvalid: () =>
    apiError("BAD_REQUEST", "REFUND_AMOUNT_INVALID", {
      message:
        'Amount must be a plain decimal above zero, in the payment\'s currency, with no more decimals than it has (such as "45.00", or "4500" in yen).',
      i18nKey: "errors.invalidAmount",
    }),
  currencyNotSupported: (currency: string) =>
    apiError("CONFLICT", "REFUND_CURRENCY_NOT_SUPPORTED", {
      message: `This payment is in ${currency}, a three-decimal currency Louez's billing does not count: it cannot be refunded through Louez.`,
      details: { currency },
    }),
  takenByHand: () =>
    apiError("CONFLICT", "REFUND_PAYMENT_TAKEN_BY_HAND", {
      message:
        "This payment was taken by hand, not online: nothing goes back through Stripe. Record the refund the store gave instead.",
    }),
  notRefundable: (reason: string) =>
    apiError("CONFLICT", "PAYMENT_NOT_REFUNDABLE", {
      message:
        reason === "deposit_hold"
          ? "A deposit hold took no money: refund the capture of it instead."
          : reason === "refund_row"
            ? "This payment is itself a refund: refund the payment it gives back."
            : reason === "failed"
              ? "This payment failed: there is nothing to refund."
              : "This payment cannot be refunded online.",
      details: { reason },
    }),
  notSettled: () =>
    apiError("CONFLICT", "PAYMENT_NOT_SETTLED", {
      message: "This payment is not settled at Stripe yet: there is nothing to refund until it is.",
    }),
  disputed: () =>
    apiError("CONFLICT", "PAYMENT_DISPUTED", {
      message: "This payment has an open dispute: it cannot be refunded until the dispute ends.",
    }),
  chargeShared: (message: string) => apiError("CONFLICT", "PAYMENT_CHARGE_SHARED", { message }),
  noStripeAccount: () =>
    apiError("CONFLICT", "NO_STRIPE_ACCOUNT", {
      message: "The store has no Stripe account to refund this payment from.",
    }),
  exceedsRefundable: (balance: OnlineRefundBalance, money: (amount: string) => string) =>
    apiError("CONFLICT", "REFUND_EXCEEDS_REFUNDABLE", {
      message:
        `Amount exceeds what is left to refund on this payment. ` +
        `Paid: ${money(balance.paid)}, already refunded: ${money(balance.refunded)}, ` +
        `being refunded: ${money(balance.inFlight)}, refundable: ${money(balance.refundable)}.`,
      details: { ...balance },
    }),
  notFromDashboard: () =>
    apiError("FORBIDDEN", "REFUND_NOT_FROM_DASHBOARD", {
      message:
        "Refunding an online payment is not available from the dashboard yet: refund it from the Stripe dashboard, or through a connected agent with a person's approval.",
    }),
  stripeUnavailable: () =>
    apiError("INTERNAL_SERVER_ERROR", "STRIPE_UNAVAILABLE", {
      message: "Stripe did not answer: nothing was refunded. Try again in a moment.",
      retryable: true,
    }),
  unavailable: () =>
    apiError("INTERNAL_SERVER_ERROR", "NOT_AVAILABLE_TO_THIS_AGENT", {
      message: "This Louez cannot refund online payments.",
    }),
};

/** Every code the refund of an online payment answers before anything is asked. */
export const STRIPE_REFUND_REFUSAL_CODES = [
  "PAYMENT_NOT_FOUND",
  "REFUND_AMOUNT_INVALID",
  "REFUND_CURRENCY_NOT_SUPPORTED",
  "REFUND_PAYMENT_TAKEN_BY_HAND",
  "PAYMENT_NOT_REFUNDABLE",
  "PAYMENT_NOT_SETTLED",
  "PAYMENT_DISPUTED",
  "PAYMENT_CHARGE_SHARED",
  "NO_STRIPE_ACCOUNT",
  "REFUND_EXCEEDS_REFUNDABLE",
  "REFUND_NOT_FROM_DASHBOARD",
  "STRIPE_UNAVAILABLE",
] as const;
