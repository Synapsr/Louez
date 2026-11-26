"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";

import { invalidateReservationAll } from "@/lib/orpc/invalidation";
import { stripeRefundsQueries } from "@/lib/queries/stripe-refunds.queries";

import { type StripeRefundOperation, pendingStripeRefunds } from "./util.stripe-refund";

interface PendingStripeRefundsWatcherProps {
  reservationId: string;
  refunds: readonly StripeRefundOperation[];
  enabled: boolean;
}

/**
 * Reads each refund still pending again, about every 30 seconds (`get_refund`, which
 * may settle it with Stripe), and reads the reservation again once one of them moved:
 * its row and its badge follow Stripe without a reload, and the page's server parts (the
 * invoices and credit notes, a refund's note owed once Stripe made it) are read again.
 * Renders nothing.
 */
export const PendingStripeRefundsWatcher = ({
  reservationId,
  refunds,
  enabled,
}: PendingStripeRefundsWatcherProps) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pending = pendingStripeRefunds(refunds);
  const reads = useQueries({
    queries: pending.map((refund) => ({
      ...stripeRefundsQueries.refund(refund.paymentId, refund.id),
      enabled,
    })),
  });
  const moved = reads.some((read, index) => {
    const known = pending[index];
    const now = read.data?.refund;
    return (
      known !== undefined &&
      now !== undefined &&
      (now.status !== known.status || now.refundPaymentId !== known.refundPaymentId)
    );
  });

  useEffect(() => {
    if (!moved) return;
    void invalidateReservationAll(queryClient, reservationId);
    router.refresh();
  }, [moved, queryClient, reservationId, router]);

  return null;
};
