import Stripe from "stripe";

// What a failed Stripe request tells about what it asked for, whichever request it was:
// a deposit hold's authorization (lib/reservations/deposit-hold-stripe.ts) or a refund
// (lib/reservations/stripe-refund-stripe.ts).

/**
 * What a failed Stripe request tells about the object it asked for.
 *
 * `refused`: Stripe took the request and created or changed nothing that holds or moves
 * money: a declined card, a card that needs the customer, an invalid request.
 * `key_reused`: the idempotency key was first sent with other parameters.
 * `indeterminate`: nobody can tell from this answer: a timeout, a network error, a
 * Stripe server error, a request with the same key still running, a rate limit, or an
 * account Louez cannot reach. `replayed` when Stripe says the answer is the one it
 * stored for an earlier request with the same key. A stored server error proves
 * nothing either: Stripe may still make the object of a request it answered 500 to.
 */
export type StripeRequestFailure =
  | { readonly kind: "refused"; readonly paymentIntentId: string | null; readonly message: string }
  | { readonly kind: "key_reused" }
  | { readonly kind: "indeterminate"; readonly replayed: boolean; readonly message: string };

/** The header Stripe sets on an answer it replays for an idempotency key. */
const REPLAYED_HEADER = "idempotent-replayed";

const isReplayed = (error: Stripe.errors.StripeError): boolean =>
  Object.entries(error.headers ?? {}).some(
    ([name, value]) => name.toLowerCase() === REPLAYED_HEADER && value === "true",
  );

export function classifyStripeFailure(error: unknown): StripeRequestFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof Stripe.errors.StripeError)) {
    return { kind: "indeterminate", replayed: false, message };
  }
  if (error instanceof Stripe.errors.StripeIdempotencyError) return { kind: "key_reused" };
  // A 409 is a request with the same key still running: its outcome is unknown.
  if (
    error instanceof Stripe.errors.StripeCardError ||
    (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode !== 409)
  ) {
    return { kind: "refused", paymentIntentId: error.payment_intent?.id ?? null, message };
  }
  return { kind: "indeterminate", replayed: isReplayed(error), message };
}
