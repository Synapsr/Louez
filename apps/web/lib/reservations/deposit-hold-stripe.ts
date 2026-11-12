import Stripe from "stripe";

import { buildReservationPaymentReference } from "@/lib/stripe";
import { stripe } from "@/lib/stripe/client";

import type { DepositIntent } from "./util.deposit-hold-transition";

// Stripe, as far as a deposit hold goes: the requests, what a failed one tells, how a
// PaymentIntent is read, and the search for the PaymentIntent of an attempt whose
// answer never came. deposit-hold.ts asks, deposit-hold-writes.ts writes; nothing here touches the
// database.

/** The PaymentIntent metadata key that carries the id of the store's attempt. */
export const DEPOSIT_HOLD_ATTEMPT_METADATA = "depositHoldAttemptId";

/** The attempt's id is its idempotency key: sent again, Stripe answers for the first. */
export const depositHoldIdempotencyKey = (attemptId: string) => `deposit-hold:${attemptId}`;

/** The longest one try of a Stripe request of a deposit hold may take. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The longest one Stripe call of a deposit hold may take: three tries at most (the
 * client retries twice by default; the authorization, once), each bounded by the
 * timeout, and the two waits between them, which Stripe may ask to last up to a
 * minute. A claimed attempt is renewed before each call, for at least this long
 * (`DEPOSIT_HOLD_CLAIM_SECONDS`): while its claim lasts, no call of a request that
 * lost it still runs.
 */
export const STRIPE_CALL_MAX_SECONDS = 3 * (REQUEST_TIMEOUT_MS / 1000) + 2 * 60;

/** How many pages of a customer's PaymentIntents a lookup reads before it gives up. */
export const ATTEMPT_LOOKUP_MAX_PAGES = 5;

export type DepositAuthorizationRequest = {
  readonly accountId: string;
  readonly attemptId: string;
  readonly customerId: string;
  readonly paymentMethodId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reservationId: string;
  readonly reservationNumber: string;
  readonly customerName: string | null;
};

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

/** What Stripe answered an authorization: the PaymentIntent it made, or why none came back. */
export type DepositAuthorizationAnswer =
  | { readonly kind: "created"; readonly intent: DepositIntent }
  | StripeRequestFailure;

/** The Stripe calls of a deposit hold. The app uses `stripeDepositHold`; tests fake it. */
export type DepositHoldStripe = {
  authorize(
    request: DepositAuthorizationRequest,
    idempotencyKey: string,
  ): Promise<DepositAuthorizationAnswer>;
  /** The PaymentIntent as it is now, on that account. */
  readIntent(accountId: string, paymentIntentId: string): Promise<DepositIntent>;
  /** The customer a saved card belongs to on that account; null once detached. */
  cardCustomer(accountId: string, paymentMethodId: string): Promise<string | null>;
  /** One page of a customer's PaymentIntents on that account, newest first. */
  listCustomerIntents(input: {
    readonly accountId: string;
    readonly customerId: string;
    /** The last PaymentIntent of the page before; null for the first page. */
    readonly startingAfter: string | null;
  }): Promise<{ readonly intents: readonly DepositIntent[]; readonly hasMore: boolean }>;
  /** Captures part or all of an authorization. Throws when Stripe captured nothing. */
  capture(accountId: string, paymentIntentId: string, amountMinor: number): Promise<DepositIntent>;
  /** Cancels an authorization; one already cancelled is released. Throws otherwise. */
  release(accountId: string, paymentIntentId: string): Promise<DepositIntent>;
};

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

/** A Stripe reference, expanded or not. */
type StripeRef = string | { readonly id: string } | null;

const stripeRefId = (value: StripeRef | undefined): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

/** What a deposit hold reads of a Stripe PaymentIntent; `Stripe.PaymentIntent` is one. */
export type StripeDepositIntent = Pick<
  Stripe.PaymentIntent,
  "id" | "status" | "amount" | "amount_received" | "currency" | "capture_method" | "metadata"
> & {
  readonly customer: StripeRef;
  readonly payment_method: StripeRef;
  /** The charge that carries the authorization, when it was expanded. */
  readonly latest_charge:
    | string
    | {
        readonly id: string;
        readonly payment_method_details?: {
          readonly card?: { readonly capture_before?: number } | null;
        } | null;
      }
    | null;
};

/**
 * A PaymentIntent of Stripe as a deposit hold reads it.
 *
 * The authorization's deadline is the one Stripe states on the card charge
 * (`capture_before`): some networks keep an authorization far longer than Stripe's
 * usual seven days, some less. Where Stripe states none (the charge was not expanded,
 * is not a card's, or carries none), Louez records none: the hold counts as live until
 * Stripe says it was cancelled or captured, and no expiry is shown for it. A date made
 * up from the usual seven days would tell a store that a hold still on the card lapsed.
 */
export const depositIntentFromStripe = (paymentIntent: StripeDepositIntent): DepositIntent => {
  const charge =
    typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : null;
  const captureBefore = charge?.payment_method_details?.card?.capture_before;
  return {
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
    amountMinor: paymentIntent.amount,
    capturedMinor: paymentIntent.amount_received,
    currency: paymentIntent.currency.toUpperCase(),
    captureBefore: typeof captureBefore === "number" ? new Date(captureBefore * 1000) : null,
    captureMethod: paymentIntent.capture_method,
    customerId: stripeRefId(paymentIntent.customer),
    paymentMethodId: stripeRefId(paymentIntent.payment_method),
    chargeId: stripeRefId(paymentIntent.latest_charge),
    attemptId: paymentIntent.metadata?.[DEPOSIT_HOLD_ATTEMPT_METADATA] ?? null,
    reservationId: paymentIntent.metadata?.reservationId ?? null,
  };
};

/**
 * The Stripe calls of a deposit hold. The authorization blocks the funds on the card
 * and does not charge them.
 */
export const stripeDepositHold: DepositHoldStripe = {
  async authorize(request, idempotencyKey) {
    const paymentReference = buildReservationPaymentReference({
      reservationId: request.reservationId,
      reservationNumber: request.reservationNumber,
      customerName: request.customerName,
      type: "deposit_hold",
    });

    try {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: request.amountMinor,
          currency: request.currency.toLowerCase(),
          description: `Deposit hold - ${paymentReference.description}`,
          customer: request.customerId,
          payment_method: request.paymentMethodId,
          capture_method: "manual", // Authorization only, no immediate capture
          confirm: true, // Confirm immediately to create the authorization
          off_session: true, // No customer interaction required
          metadata: {
            ...paymentReference.metadata,
            [DEPOSIT_HOLD_ATTEMPT_METADATA]: request.attemptId,
          },
          expand: ["latest_charge"],
        },
        {
          stripeAccount: request.accountId,
          idempotencyKey,
          timeout: REQUEST_TIMEOUT_MS,
          maxNetworkRetries: 1,
        },
      );
      return { kind: "created", intent: depositIntentFromStripe(paymentIntent) };
    } catch (error) {
      return classifyStripeFailure(error);
    }
  },

  async readIntent(accountId, paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["latest_charge"] },
      { stripeAccount: accountId, timeout: REQUEST_TIMEOUT_MS },
    );
    return depositIntentFromStripe(paymentIntent);
  },

  async cardCustomer(accountId, paymentMethodId) {
    const paymentMethod = await stripe.paymentMethods.retrieve(
      paymentMethodId,
      {},
      { stripeAccount: accountId, timeout: REQUEST_TIMEOUT_MS },
    );
    return stripeRefId(paymentMethod.customer);
  },

  async listCustomerIntents({ accountId, customerId, startingAfter }) {
    const page = await stripe.paymentIntents.list(
      {
        customer: customerId,
        limit: 100,
        expand: ["data.latest_charge"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: accountId, timeout: REQUEST_TIMEOUT_MS },
    );
    return { intents: page.data.map(depositIntentFromStripe), hasMore: page.has_more };
  },

  /**
   * Stripe captures a PaymentIntent once; any amount left is released. The key makes a
   * capture repeated after a lost answer return that capture, so Louez can record it; a
   * capture of another amount is another key, and Stripe refuses it.
   */
  async capture(accountId, paymentIntentId, amountMinor) {
    const paymentIntent = await stripe.paymentIntents.capture(
      paymentIntentId,
      { amount_to_capture: amountMinor, expand: ["latest_charge"] },
      {
        stripeAccount: accountId,
        idempotencyKey: `deposit-capture:${paymentIntentId}:${amountMinor}`,
      },
    );
    return depositIntentFromStripe(paymentIntent);
  },

  /**
   * A hold already cancelled is released: by an earlier call whose answer was lost, or
   * by Stripe when the authorization expired.
   */
  async release(accountId, paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.cancel(
        paymentIntentId,
        { expand: ["latest_charge"] },
        { stripeAccount: accountId, timeout: REQUEST_TIMEOUT_MS },
      );
      return depositIntentFromStripe(paymentIntent);
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
      const intent = await stripeDepositHold.readIntent(accountId, paymentIntentId);
      if (intent.status !== "canceled") throw error;
      return intent;
    }
  },
};

export type AttemptLookup =
  | { readonly kind: "found"; readonly intent: DepositIntent }
  /** Every PaymentIntent of the card's customer was read: none answers the attempt. */
  | { readonly kind: "absent" }
  /** The search could not be finished: it says nothing. */
  | { readonly kind: "unknown" };

/**
 * The attempt's PaymentIntent, among those of the customer it was sent with, on the
 * account the attempt was sent to. That customer is the one the attempt row stored
 * when it was claimed, so a card detached since does not stop the search; an attempt
 * older than that column reads it from its card, which belongs to one customer for
 * good (Stripe refuses a request that names another), and is lost once the card is
 * detached. No date bounds the search. `absent` only when the listing was read to its
 * end: a search stopped at its page bound, a page that comes back empty while Stripe
 * says more follow, or one that cannot name the customer, is `unknown`.
 */
export async function findAttemptIntent(
  port: DepositHoldStripe,
  attempt: {
    readonly id: string;
    readonly accountId: string;
    readonly paymentMethodId: string;
    /** The customer the attempt was sent with; null on an attempt older than the column. */
    readonly customerId: string | null;
  },
): Promise<AttemptLookup> {
  const { accountId } = attempt;
  const customerId =
    attempt.customerId ?? (await port.cardCustomer(accountId, attempt.paymentMethodId));
  if (!customerId) return { kind: "unknown" };

  let startingAfter: string | null = null;
  for (let page = 0; page < ATTEMPT_LOOKUP_MAX_PAGES; page++) {
    const { intents, hasMore } = await port.listCustomerIntents({
      accountId,
      customerId,
      startingAfter,
    });
    const intent = intents.find((candidate) => candidate.attemptId === attempt.id);
    if (intent) return { kind: "found", intent };
    if (!hasMore) return { kind: "absent" };
    // More follow, and nothing to start the next page after: the listing is not complete.
    const last = intents.at(-1);
    if (!last) return { kind: "unknown" };
    startingAfter = last.paymentIntentId;
  }
  return { kind: "unknown" };
}
