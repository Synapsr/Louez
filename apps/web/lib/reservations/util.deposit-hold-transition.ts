// What Louez writes about a deposit hold, as a pure function of three facts: the state
// of the hold row a PaymentIntent belongs to, the state the provider gives that
// PaymentIntent, and what the reservation references. The store's request, the
// customer's page, the Connect webhook and the outbox's release all decide here, and
// write through one writer (`settleDepositIntent`, deposit-hold-writes.ts).
//
// A hold row says what the provider last said of its PaymentIntent, and only moves
// forward: `pending` (asked, not known held), `failed` (the provider refused, or the
// attempt was closed with nothing found), then `authorized` (the provider holds the
// funds), then `completed` (captured) or `cancelled` (the provider holds nothing any
// more). Both ends are final. An authorization Louez decided against, because the
// reservation holds another, stays `authorized` with its release owed
// (`payments.release_owed_at`) until the provider confirms its cancellation: it is
// never the reservation's hold.
//
// A store's attempt row is never deleted. Closing an attempt sets it `failed`: no new
// request asks about it, and it keeps its reservation, account, amount, currency, card
// and id. A closed attempt still reconciles: when its PaymentIntent shows up later,
// held or captured, it is settled from `failed` like any other, so a wrong verdict of
// absence at worst records a second hold and releases it.

/** A deposit PaymentIntent as the provider has it, on one connected account. */
export type DepositIntent = {
  readonly paymentIntentId: string;
  /** The provider's status: `requires_capture` holds the funds. */
  readonly status: string;
  /** The amount authorized. */
  readonly amountMinor: number;
  /** What a capture took. */
  readonly capturedMinor: number;
  /** Upper case. */
  readonly currency: string;
  /** Until when the provider keeps the authorization; null when it states none. */
  readonly captureBefore: Date | null;
  /** `manual` for an authorization that is captured later. */
  readonly captureMethod: string;
  readonly customerId: string | null;
  readonly paymentMethodId: string | null;
  readonly chargeId: string | null;
  /** The store's attempt it answers, from its metadata; null for the customer's own. */
  readonly attemptId: string | null;
  /** The reservation its metadata names. */
  readonly reservationId: string | null;
};

export type IntentState =
  /** Holds nothing and is not over: the card was declined, or needs the customer. */
  | "unconfirmed"
  /** The provider has not decided yet. */
  | "processing"
  /** The funds are held. */
  | "held"
  | "canceled"
  | "captured";

const UNCONFIRMED = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

/** A status this code does not know is one whose outcome is not known. */
export const intentStateOf = (status: string): IntentState => {
  if (status === "requires_capture") return "held";
  if (status === "canceled") return "canceled";
  if (status === "succeeded") return "captured";
  return UNCONFIRMED.has(status) ? "unconfirmed" : "processing";
};

/** A `deposit_hold` payment row, as far as a decision reads it. */
export type HoldRow = {
  readonly id: string;
  readonly status: string;
  readonly paymentIntentId: string | null;
  readonly accountId: string | null;
  readonly releaseOwed: boolean;
  /** What the row was written with; null on a row older than the fact. */
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly paymentMethodId: string | null;
};

export type HoldRowState =
  | "none"
  | "pending"
  | "failed"
  | "authorized"
  | "release_owed"
  | "completed"
  | "cancelled";

/** A status no hold row is written with is read as final: nothing adopts it. */
export const holdRowStateOf = (row: HoldRow | null): HoldRowState => {
  if (!row) return "none";
  if (row.status === "pending" || row.status === "failed" || row.status === "completed") {
    return row.status;
  }
  if (row.status === "authorized") return row.releaseOwed ? "release_owed" : "authorized";
  return "cancelled";
};

export type ReservationRelation =
  /** The reservation references this PaymentIntent as its authorized hold. */
  | "this_live"
  /** It references this PaymentIntent, captured or released since. */
  | "this_done"
  /** It holds another PaymentIntent, authorized or captured. */
  | "other_live"
  /** It holds none. */
  | "free";

export const reservationRelationOf = (
  reservation: {
    readonly depositStatus: string | null;
    readonly depositPaymentIntentId: string | null;
  },
  paymentIntentId: string,
): ReservationRelation => {
  if (reservation.depositPaymentIntentId === paymentIntentId) {
    return reservation.depositStatus === "authorized" ? "this_live" : "this_done";
  }
  const live =
    reservation.depositStatus === "authorized" || reservation.depositStatus === "captured";
  return live && reservation.depositPaymentIntentId !== null ? "other_live" : "free";
};

export type HoldActivity =
  | "deposit_authorized"
  | "deposit_captured"
  | "deposit_released"
  | "deposit_failed";

export type HoldOutcome =
  /** The PaymentIntent is the reservation's hold. */
  | "authorized"
  /** The provider holds it and the reservation holds another: its release is owed. */
  | "superseded"
  | "captured"
  /** The provider cancelled it. */
  | "released"
  /** It holds nothing. */
  | "failed"
  /** Nobody knows yet. */
  | "pending"
  /** The snapshot is older than what the row records, or contradicts it: nothing is written. */
  | "stale";

export type HoldWrites = {
  /**
   * The hold row's status, written with the PaymentIntent's facts, on the row or on a
   * new one; `close` sets `failed` an attempt no PaymentIntent was found for, and keeps
   * the row; null leaves the row, or the absence of one, as it is.
   */
  readonly row:
    | null
    | "close"
    | {
        readonly status: "pending" | "failed" | "authorized" | "completed" | "cancelled";
        readonly releaseOwed: boolean;
      };
  /** The reservation's deposit status, with this PaymentIntent as its reference. */
  readonly reservation: null | "authorized" | "captured" | "released" | "failed";
  /** One `deposit_capture` row holds what was captured. */
  readonly capture: boolean;
  /** One line per PaymentIntent and kind, whoever writes it first. */
  readonly activity: HoldActivity | null;
  /** The release becomes owed here: one outbox row asks the provider for it. */
  readonly owesRelease: boolean;
  readonly outcome: HoldOutcome;
};

const nothing = (outcome: HoldOutcome): HoldWrites => ({
  row: null,
  reservation: null,
  capture: false,
  activity: null,
  owesRelease: false,
  outcome,
});

const STALE = nothing("stale");

const rowTo = (status: "pending" | "failed" | "authorized" | "completed" | "cancelled") =>
  ({ status, releaseOwed: false }) as const;

function heldWrites(row: HoldRowState, relation: ReservationRelation): HoldWrites {
  // A final row is not reopened by an older snapshot.
  if (row === "completed" || row === "cancelled") return STALE;
  // Decided against once, never adopted, even once the other hold is gone.
  if (row === "release_owed") return nothing("superseded");
  if (relation === "this_done") return STALE;
  if (relation === "other_live") {
    return {
      ...nothing("superseded"),
      row: { status: "authorized", releaseOwed: true },
      owesRelease: true,
    };
  }
  const recorded = row === "authorized";
  if (relation === "this_live") {
    return { ...nothing("authorized"), row: recorded ? null : rowTo("authorized") };
  }
  return {
    ...nothing("authorized"),
    row: recorded ? null : rowTo("authorized"),
    reservation: "authorized",
    activity: "deposit_authorized",
  };
}

function canceledWrites(row: HoldRowState, relation: ReservationRelation): HoldWrites {
  // The provider cancels no PaymentIntent it captured.
  if (row === "completed") return STALE;
  const released = relation === "this_live";
  return {
    ...nothing("released"),
    row: row === "cancelled" ? null : rowTo("cancelled"),
    reservation: released ? "released" : null,
    activity: released ? "deposit_released" : null,
  };
}

function capturedWrites(row: HoldRowState, relation: ReservationRelation): HoldWrites {
  // The provider captures no PaymentIntent it cancelled.
  if (row === "cancelled") return STALE;
  const settled = row === "completed";
  // A capture settles onto the reservation it belongs to, unless the reservation holds
  // another PaymentIntent. One recorded before, apart from the reservation, stays apart.
  const onReservation =
    relation === "this_live" || relation === "this_done" || (relation === "free" && !settled);
  return {
    ...nothing("captured"),
    row: settled ? null : rowTo("completed"),
    reservation: onReservation ? "captured" : null,
    capture: true,
    activity: "deposit_captured",
  };
}

function unconfirmedWrites(row: HoldRowState, relation: ReservationRelation): HoldWrites {
  // A PaymentIntent that held funds does not hold none again.
  if (row !== "none" && row !== "pending" && row !== "failed") return STALE;
  const attemptFailed = row === "pending";
  return {
    ...nothing("failed"),
    row: attemptFailed ? rowTo("failed") : null,
    reservation: relation === "free" && row !== "failed" ? "failed" : null,
    activity: attemptFailed ? "deposit_failed" : null,
  };
}

function processingWrites(row: HoldRowState): HoldWrites {
  if (row !== "none" && row !== "pending" && row !== "failed") return STALE;
  // The attempt keeps its row, which now names its PaymentIntent.
  return { ...nothing("pending"), row: row === "pending" ? rowTo("pending") : null };
}

/**
 * The writes for one PaymentIntent, from the state of its hold row, the state the
 * provider gives it, and what the reservation references.
 */
export function depositHoldTransition(
  row: HoldRowState,
  intent: IntentState,
  relation: ReservationRelation,
): HoldWrites {
  switch (intent) {
    case "held":
      return heldWrites(row, relation);
    case "canceled":
      return canceledWrites(row, relation);
    case "captured":
      return capturedWrites(row, relation);
    case "unconfirmed":
      return unconfirmedWrites(row, relation);
    case "processing":
      return processingWrites(row);
  }
}

/**
 * The writes for a store's attempt closed with no PaymentIntent found: the provider
 * refused the request, a complete listing past the life of its key holds none, or the
 * store declared it found none at the provider. Its row is kept, `failed`, so the next
 * attempt has a new key and a PaymentIntent that shows up later still finds its row.
 * `refused` when the provider said no (a card it does not know, an invalid request):
 * the deposit then failed, unless the reservation holds one.
 */
export function absentAttemptTransition(input: {
  readonly refused: boolean;
  /** The reservation's deposit is authorized or captured, on another PaymentIntent. */
  readonly reservationHolds: boolean;
}): HoldWrites {
  return {
    ...nothing("failed"),
    row: "close",
    reservation: input.refused && !input.reservationHolds ? "failed" : null,
    activity: input.refused ? "deposit_failed" : null,
  };
}

/** An attempt row that has no PaymentIntent yet, open or closed: one may still show up. */
export const awaitsIntent = (hold: HoldRow): boolean =>
  hold.paymentIntentId === null && (hold.status === "pending" || hold.status === "failed");

export type IntentRefusal =
  /** Its metadata names another reservation, or none. */
  | "other_reservation"
  /** It is not an authorization captured later. */
  | "not_a_hold"
  /** Its row, or its attempt's, was written for another connected account. */
  | "other_account"
  /** It comes from an account that is not the store's and has no row naming it. */
  | "unknown_on_account"
  /** The attempt it names already has its PaymentIntent. */
  | "attempt_bound"
  /** Its amount, currency or card is not what the attempt was sent with. */
  | "facts_mismatch";

export type IntentBinding =
  | { readonly ok: true; readonly row: HoldRow | null }
  | { readonly ok: false; readonly reason: IntentRefusal };

const refuse = (reason: IntentRefusal): IntentBinding => ({ ok: false, reason });

/**
 * The hold row a PaymentIntent is written on, or why it is written on none. Nothing
 * of an event is trusted here but what the provider answered for it.
 *
 * - A row that names the PaymentIntent is its row, on the account the row names.
 * - Else the store's attempt it answers, while that attempt has no PaymentIntent yet,
 *   open or closed, was sent to that account, and was sent with what the
 *   PaymentIntent holds: the amount, the currency and the card. The card pins the
 *   customer: a saved card belongs to one customer for good. A closed attempt binds
 *   as an open one does: what Stripe made of it is recorded, whenever it shows up.
 * - Else none, which only the store's connected account of today is believed for:
 *   the customer's own authorization. An account the store left is believed for
 *   the rows that name it, and for nothing else.
 */
export function bindDepositIntent(input: {
  readonly reservationId: string;
  readonly holds: readonly HoldRow[];
  readonly intent: DepositIntent;
  /** The connected account the PaymentIntent was read on. */
  readonly accountId: string;
  /** Whether that account is the store's today. */
  readonly currentAccount: boolean;
}): IntentBinding {
  const { intent, accountId, holds } = input;
  if (intent.reservationId !== input.reservationId) return refuse("other_reservation");
  if (intent.captureMethod !== "manual") return refuse("not_a_hold");

  const own = holds.find((hold) => hold.paymentIntentId === intent.paymentIntentId);
  if (own) {
    return own.accountId !== null && own.accountId !== accountId
      ? refuse("other_account")
      : { ok: true, row: own };
  }

  const attempt = intent.attemptId ? holds.find((hold) => hold.id === intent.attemptId) : null;
  if (attempt) {
    if (!awaitsIntent(attempt)) return refuse("attempt_bound");
    if (attempt.accountId !== accountId) return refuse("other_account");
    const asSent =
      attempt.amountMinor === intent.amountMinor &&
      attempt.currency?.toUpperCase() === intent.currency.toUpperCase() &&
      attempt.paymentMethodId !== null &&
      attempt.paymentMethodId === intent.paymentMethodId &&
      intent.customerId !== null;
    return asSent ? { ok: true, row: attempt } : refuse("facts_mismatch");
  }

  return input.currentAccount ? { ok: true, row: null } : refuse("unknown_on_account");
}

/**
 * Whether a hold row gives a connected account a say about a PaymentIntent: the row
 * that names both, or an attempt sent to that account that has no PaymentIntent yet,
 * open or closed. Asked before an account the store left is read at all;
 * `bindDepositIntent` then decides on what the provider answers.
 */
export const holdsNameIntentOnAccount = (
  holds: readonly HoldRow[],
  claim: {
    readonly accountId: string;
    readonly paymentIntentId: string;
    readonly attemptId: string | null;
  },
): boolean =>
  holds.some(
    (hold) =>
      hold.accountId === claim.accountId &&
      (hold.paymentIntentId === claim.paymentIntentId ||
        (hold.id === claim.attemptId && awaitsIntent(hold))),
  );

/** What makes a PaymentIntent the store names not the one its attempt asked for. */
export type PastedIntentMismatch =
  /** Its metadata names another reservation. */
  | "reservation"
  /** Its metadata names another attempt. */
  | "attempt"
  /** It is not an authorization captured later. */
  | "capture_method"
  | "amount"
  | "currency"
  /** It is not on the card the attempt was sent with. */
  | "card"
  /** It is not for the customer the attempt was sent with, or for none. */
  | "customer"
  /** A hold row of the reservation already names it: it is not the attempt's. */
  | "recorded";

/**
 * Why a PaymentIntent the store names, read on the attempt's account, is not the
 * attempt's; empty when it is. Its metadata is compared when it has any; the amount,
 * the currency, the card and the customer always, against what the attempt was sent
 * with. An attempt claimed before its customer was stored only asks for one.
 */
export function pastedIntentMismatches(input: {
  readonly reservationId: string;
  readonly attempt: {
    readonly id: string;
    readonly amountMinor: number;
    readonly currency: string;
    readonly paymentMethodId: string;
    readonly customerId: string | null;
  };
  readonly intent: DepositIntent;
  readonly holds: readonly HoldRow[];
}): PastedIntentMismatch[] {
  const { attempt, intent } = input;
  const mismatches: PastedIntentMismatch[] = [];
  if (intent.reservationId !== null && intent.reservationId !== input.reservationId) {
    mismatches.push("reservation");
  }
  if (intent.attemptId !== null && intent.attemptId !== attempt.id) mismatches.push("attempt");
  if (intent.captureMethod !== "manual") mismatches.push("capture_method");
  if (intent.amountMinor !== attempt.amountMinor) mismatches.push("amount");
  if (intent.currency.toUpperCase() !== attempt.currency.toUpperCase()) {
    mismatches.push("currency");
  }
  if (intent.paymentMethodId !== attempt.paymentMethodId) mismatches.push("card");
  if (
    intent.customerId === null ||
    (attempt.customerId !== null && intent.customerId !== attempt.customerId)
  ) {
    mismatches.push("customer");
  }
  if (input.holds.some((hold) => hold.paymentIntentId === intent.paymentIntentId)) {
    mismatches.push("recorded");
  }
  return mismatches;
}
