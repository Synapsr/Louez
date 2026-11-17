import type { FeeFacts } from "@/lib/billing-sync/fee-metadata";

/**
 * The pay-as-you-go commission a payment carries, for `payg_fee_charged`
 * (docs/analytics/lifecycle.md): the reservation commission of the fee facts it was
 * created with, whichever policy set it (legacy, or the billing service's store or
 * default policy). A legacy payment without facts and with an application fee, on a
 * pay-as-you-go store, was all commission (the webhook's metering reads it so too).
 * Null when the payment carries none: a plan's store, a free reservation.
 */
export function paygFeeOfPayment(input: {
  feeFacts: Pick<FeeFacts, "reservationMinor" | "policyScope"> | null;
  applicationFeeCents: number;
  isPayAsYouGoStore: boolean;
}): { feeCents: number; policyScope: string } | null {
  if (input.feeFacts) {
    return input.feeFacts.reservationMinor > 0
      ? { feeCents: input.feeFacts.reservationMinor, policyScope: input.feeFacts.policyScope }
      : null;
  }
  if (input.isPayAsYouGoStore && input.applicationFeeCents > 0) {
    return { feeCents: input.applicationFeeCents, policyScope: "legacy" };
  }
  return null;
}
