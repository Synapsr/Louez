import { z } from "zod";

import type { RefundPaymentInput } from "@louez/api/contracts/stripe-refunds";
import { refundAmount, type RefundVerdict } from "@louez/api/services/payment-amount";

import { typedAmount } from "@/lib/reservations/util.typed-amount";

/** The longest note a refund keeps (`refundPaymentInput.notes`). */
export const STRIPE_REFUND_NOTES_MAX = 1000;

/** Why a refund is made, as Stripe records it: the refund's own reasons. */
export const STRIPE_REFUND_REASONS = [
  "requested_by_customer",
  "duplicate",
] as const satisfies readonly NonNullable<RefundPaymentInput["reason"]>[];

/** Why an amount is refused, as the refund's own amount rule says it. */
export type StripeRefundAmountRefusal = Extract<RefundVerdict, { ok: false }>["refusal"];

/**
 * The amount a person typed, judged as the refund judges it: a plain decimal above zero,
 * with no more decimals than the payment's currency, at most what is still refundable.
 */
export const judgeStripeRefundAmount = (
  raw: string,
  currency: string,
  refundableHundredths: number,
): RefundVerdict => refundAmount(typedAmount(raw) ?? "", currency, refundableHundredths);

/** The refund dialog's values, each refusal worded by the dialog. */
export function stripeRefundFormSchema(input: {
  currency: string;
  refundableHundredths: number;
  amountMessage: (refusal: StripeRefundAmountRefusal) => string;
  notesTooLong: string;
}) {
  return z.object({
    amount: z.string().superRefine((raw, context) => {
      const verdict = judgeStripeRefundAmount(raw, input.currency, input.refundableHundredths);
      if (!verdict.ok) {
        context.addIssue({ code: "custom", message: input.amountMessage(verdict.refusal) });
      }
    }),
    reason: z.enum(STRIPE_REFUND_REASONS),
    notes: z.string().max(STRIPE_REFUND_NOTES_MAX, input.notesTooLong),
  });
}

export type StripeRefundFormValues = z.infer<ReturnType<typeof stripeRefundFormSchema>>;
