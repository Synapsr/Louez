import type { ApiEffectSenders } from "@louez/api/platform/effects";

import { expireRentalSessions } from "./rental-session-gate";

/**
 * The sender of `payment.rentalSessionsExpiry` (`expireRentalSessions`): the
 * rental's Checkout Sessions a write that lowered the balance left open, expired
 * at Stripe, on the row's own store and reservation. It sends nothing; it throws
 * while a session's state is unknown, so the outbox tries again.
 */
export function createRentalSessionEffectSenders(): Pick<
  ApiEffectSenders,
  "payment.rentalSessionsExpiry"
> {
  return {
    "payment.rentalSessionsExpiry": (payload, context) =>
      expireRentalSessions(
        {
          storeId: context.row.storeId,
          reservationId: context.row.reservationId ?? payload.reservationId,
          paymentIds: payload.paymentIds,
        },
        () => context.assertClaim(),
      ),
  };
}
