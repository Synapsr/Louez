import { EFFECT_MAX_ATTEMPTS, type ApiEffectSenders } from "@louez/api/platform/effects";
import { apiEffects, db } from "@louez/db";
import { eq } from "drizzle-orm";

import { log } from "@/lib/evlog";

import { expireRentalSessions } from "./rental-session-gate";

/** Whether this run of the row is the outbox's last: its attempts, counted at the claim, reach the limit. */
async function isLastRun(effectId: string): Promise<boolean> {
  const [row] = await db
    .select({ attempts: apiEffects.attempts })
    .from(apiEffects)
    .where(eq(apiEffects.id, effectId));
  return (row?.attempts ?? 0) >= EFFECT_MAX_ATTEMPTS;
}

/**
 * The sender of `payment.rentalSessionsExpiry` (`expireRentalSessions`): the
 * rental's Checkout Sessions a write that lowered the balance left open, expired
 * at Stripe, on the row's own store and reservation. It sends nothing; it throws
 * while a session's state is unknown or one Stripe took is not recorded, so the
 * outbox tries again and reports each failure to error tracking. On its last run
 * it logs an error naming the reservation, for a person to look at: the money
 * Stripe took stays to be recorded (by its webhook, or by hand).
 */
export function createRentalSessionEffectSenders(): Pick<
  ApiEffectSenders,
  "payment.rentalSessionsExpiry"
> {
  return {
    "payment.rentalSessionsExpiry": async (payload, context) => {
      const reservationId = context.row.reservationId ?? payload.reservationId;
      try {
        return await expireRentalSessions(
          { storeId: context.row.storeId, reservationId, paymentIds: payload.paymentIds },
          () => context.assertClaim(),
        );
      } catch (error) {
        if (await isLastRun(context.effectId)) {
          const message = error instanceof Error ? error.message : String(error);
          log.error({
            rentalSessions: { event: "expiry_given_up", reservationId, error: message },
          });
          throw new Error(`Gave up on the rental sessions of ${reservationId}: ${message}`, {
            cause: error,
          });
        }
        throw error;
      }
    },
  };
}
