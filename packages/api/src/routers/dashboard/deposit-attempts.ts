import {
  depositAttemptErrors,
  resolveDepositAttemptInput,
  resolveDepositAttemptOutput,
} from "../../contracts/deposit-attempts";
import { reservationErrors } from "../../contracts/reservations";
import { apiError } from "../../platform/errors";
import { storeProcedure } from "../../platform/procedures";

/**
 * The store gets out of a deposit hold Stripe has not confirmed and nothing else can
 * settle, after it checked its Stripe dashboard: Louez looks the attempt up first and
 * records the PaymentIntent it finds, else closes the attempt on the store's word. The
 * logic is the app's (`ports.depositHolds`, apps/web lib/reservations/deposit-hold.ts);
 * this holds the contract, the rights and the errors.
 *
 * A session only: it decides, on the store's word, about money held on a customer's
 * card. A closure that was wrong can leave an extra hold on the card: Louez records it
 * when Stripe's event about it arrives, as the reservation's deposit when it has none,
 * and releases it when another hold secures it. An agent does not make that call.
 */
export const resolveDepositAttempt = storeProcedure
  .meta({
    capability: "reservations.resolveDepositAttempt",
    scope: { domain: "payments", level: "write" },
    sensitive: "money",
    actors: ["session"],
    mcp: {
      exclude:
        "decides about money held on a customer's card on the store's word, after it checked its Stripe dashboard: the dashboard only",
    },
  })
  .input(resolveDepositAttemptInput)
  .output(resolveDepositAttemptOutput)
  .handler(async ({ context, input }) => {
    const port = context.ports.depositHolds;
    if (!port) {
      throw apiError("INTERNAL_SERVER_ERROR", "NOT_AVAILABLE_TO_THIS_AGENT", {
        message: "This Louez cannot resolve deposit holds.",
      });
    }
    const { reservationId } = input;
    const resolved = await port.resolveUnconfirmedAttempt({
      reservationId,
      storeId: context.actor.storeId,
      actorUserId: context.actor.credential.userId,
    });
    if (resolved.ok) {
      return {
        reservationId,
        outcome: resolved.outcome,
        paymentIntentId: resolved.paymentIntentId,
      };
    }
    switch (resolved.error) {
      case "reservation_not_found":
        throw reservationErrors.notFound(reservationId);
      case "no_unconfirmed_attempt":
        throw depositAttemptErrors.none(reservationId);
      case "attempt_in_progress":
        throw depositAttemptErrors.inProgress(reservationId);
    }
  });
