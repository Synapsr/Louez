import { mutationOptions } from "@tanstack/react-query";

import type { RefundPaymentInput } from "@louez/api/contracts/stripe-refunds";

import { orpc, orpcClient } from "@/lib/orpc/react";

/**
 * How often a pending refund is read again (`get_refund`): reading it more often
 * answers the same state, as the refund settles with Stripe at most this often.
 */
export const STRIPE_REFUND_POLL_MS = 30_000;

/** One send of the refund dialog: its input and the key of its attempt. */
export interface StripeRefundSend {
  input: RefundPaymentInput;
  idempotencyKey: string;
}

export const stripeRefundsQueries = {
  /** What the payment could give back now, read from Stripe when the dialog opens. */
  preview: (paymentId: string) =>
    orpc.dashboard.payments.previewRefund.queryOptions({
      input: { paymentId },
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }),
  /** A refund still pending, read again until Stripe gives its final word. */
  refund: (paymentId: string, refundId: string) =>
    orpc.dashboard.payments.getRefund.queryOptions({
      input: { paymentId, refundId },
      refetchInterval: STRIPE_REFUND_POLL_MS,
    }),
};

/** Every refund being sent: a dialog does not close under one. */
const refundKey = () => orpc.dashboard.payments.refund.key();

export const stripeRefundsMutations = {
  /** The refund, with its attempt's key: the same attempt sent twice gives one refund. */
  refund: () =>
    mutationOptions({
      mutationKey: refundKey(),
      mutationFn: ({ input, idempotencyKey }: StripeRefundSend) =>
        orpcClient.dashboard.payments.refund(input, { context: { idempotencyKey } }),
    }),
  refundKey,
  /** The store's Stripe dashboard, on one payment: the step's page, where the person goes on. */
  openInStripe: () => orpc.dashboard.payments.openStripeDashboard.mutationOptions(),
};
