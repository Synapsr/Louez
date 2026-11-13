import {
  ConsumableStockError,
  changeReservationStatus,
  db,
  isReservationChangeBusyError,
  isStoreNotAcceptingReservationsError,
  payments,
  reservations,
  runReservationChange,
  runReservationOnlyChange,
  type ReservationBillingEffect,
  type ReservationEffectRunner,
  type StoreNotAcceptingReservationsError,
} from "@louez/db";
import { and, eq } from "drizzle-orm";

import { validateReservationContract } from "./reservation-contract-validation";
import {
  ReservationInventoryError,
  checkExistingReservationInventory,
} from "./reservation-inventory";

/**
 * The customer's status changes from the online store's account page: a quote
 * accepted or declined, a pending request cancelled
 * (docs/domain/reservation-changes.md, slice 6a-2). Each reads the reservation
 * scoped to the store and the customer, changes its status under the owner
 * entry's lock, then attempts the fee. The caller resolves the store and the
 * customer's session before, and sends the messages after: they live in the
 * app.
 *
 * Lock order (docs/code-review/04-data-layer.md, DL-12): the acceptance takes
 * the quote's products, then the quote (`runReservationChange`), and its stock
 * check locks the units it holds last; the decline and the cancellation move
 * no stock and lock the reservation alone (`runReservationOnlyChange`), the
 * cancellation then its payments. A lost deadlock, or a product added to the
 * quote meanwhile, runs the transaction again; still busy after three runs,
 * the change answers `tryAgain` and nothing was written.
 */

/** The customer, on the store, as the action resolved them; and the app's fee runner. */
export interface CustomerStatusChangeCaller {
  storeId: string;
  customerId: string;
  runReservationEffects: ReservationEffectRunner;
}

export type CustomerStatusChangeRequest =
  | { action: "accept_quote"; reservationId: string }
  | { action: "decline_quote"; reservationId: string }
  | { action: "cancel_request"; reservationId: string; acknowledgePayment: boolean };

export interface CustomerStatusChangeOptions<Reservation> {
  /**
   * Runs once, after the change committed, with the reservation as read
   * before the lock, and before the fee, which is attempted after it whatever
   * it does. Never on a refusal. The acceptance opens its Stripe session here:
   * the session takes the fee at source only while no fee row exists.
   */
  beforeFee?(reservation: Reservation): Promise<void>;
}

/** The change committed: the reservation as read before the lock, for the caller's messages. */
export interface CustomerStatusChanged<Reservation> {
  ok: true;
  changed: true;
  reservation: Reservation;
}

/** One of today's keys, returned to the customer: never a unit or a shortfall. */
export interface CustomerStatusRefused {
  ok: false;
  error: string;
}

/** The store's card gate is closed: the caller logs it and answers the generic key with the store's contact. */
export interface CustomerStatusGated {
  ok: false;
  gate: StoreNotAcceptingReservationsError;
}

/** A cancellation of a reservation already cancelled, by anyone: nothing written. */
export interface CustomerStatusUnchanged {
  ok: true;
  changed: false;
}

/** The customer's own reservation in the store: every read and lock of these changes is scoped to it. */
const customerScope = (caller: CustomerStatusChangeCaller, reservationId: string) =>
  and(
    eq(reservations.id, reservationId),
    eq(reservations.storeId, caller.storeId),
    eq(reservations.customerId, caller.customerId),
  );

const readQuote = (caller: CustomerStatusChangeCaller, reservationId: string) =>
  db.query.reservations.findFirst({
    where: customerScope(caller, reservationId),
    with: { customer: true, items: true },
  });

const readDeclinedQuote = (caller: CustomerStatusChangeCaller, reservationId: string) =>
  db.query.reservations.findFirst({
    where: customerScope(caller, reservationId),
    with: { customer: true },
  });

const readRequest = (caller: CustomerStatusChangeCaller, reservationId: string) =>
  db.query.reservations.findFirst({
    where: customerScope(caller, reservationId),
    columns: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      totalAmount: true,
      currency: true,
      tulipContractId: true,
    },
    with: { customer: { columns: { firstName: true, lastName: true, email: true, phone: true } } },
  });

export type AcceptedQuote = NonNullable<Awaited<ReturnType<typeof readQuote>>>;
export type DeclinedQuote = NonNullable<Awaited<ReturnType<typeof readDeclinedQuote>>>;
export type CancelledRequest = NonNullable<Awaited<ReturnType<typeof readRequest>>>;

/** `beforeFee`, then the fee in a `finally`: a callback that throws still has the fee attempted. */
async function attemptFee<Reservation>(
  caller: CustomerStatusChangeCaller,
  effects: ReservationBillingEffect[],
  reservation: Reservation | null,
  options: CustomerStatusChangeOptions<Reservation>,
) {
  try {
    if (reservation !== null) await options.beforeFee?.(reservation);
  } finally {
    await caller.runReservationEffects(effects);
  }
}

/**
 * The customer accepts or declines a quote, or cancels a pending request: the
 * read scoped to the customer, the status transaction, then `beforeFee` and
 * the fee. Refusals are returned, never thrown; anything else propagates.
 */
export function changeCustomerReservationStatus(
  caller: CustomerStatusChangeCaller,
  request: { action: "accept_quote"; reservationId: string },
  options?: CustomerStatusChangeOptions<AcceptedQuote>,
): Promise<CustomerStatusChanged<AcceptedQuote> | CustomerStatusRefused | CustomerStatusGated>;
export function changeCustomerReservationStatus(
  caller: CustomerStatusChangeCaller,
  request: { action: "decline_quote"; reservationId: string },
  options?: CustomerStatusChangeOptions<DeclinedQuote>,
): Promise<CustomerStatusChanged<DeclinedQuote> | CustomerStatusRefused>;
export function changeCustomerReservationStatus(
  caller: CustomerStatusChangeCaller,
  request: { action: "cancel_request"; reservationId: string; acknowledgePayment: boolean },
  options?: CustomerStatusChangeOptions<CancelledRequest>,
): Promise<
  CustomerStatusChanged<CancelledRequest> | CustomerStatusUnchanged | CustomerStatusRefused
>;
export function changeCustomerReservationStatus(
  caller: CustomerStatusChangeCaller,
  request: CustomerStatusChangeRequest,
  options: CustomerStatusChangeOptions<AcceptedQuote & DeclinedQuote & CancelledRequest> = {},
): Promise<
  | CustomerStatusChanged<AcceptedQuote | DeclinedQuote | CancelledRequest>
  | CustomerStatusUnchanged
  | CustomerStatusRefused
  | CustomerStatusGated
> {
  switch (request.action) {
    case "accept_quote":
      return acceptQuote(caller, request.reservationId, options);
    case "decline_quote":
      return declineQuote(caller, request.reservationId, options);
    case "cancel_request":
      return cancelRequest(caller, request.reservationId, request.acknowledgePayment, options);
  }
}

async function acceptQuote(
  caller: CustomerStatusChangeCaller,
  reservationId: string,
  options: CustomerStatusChangeOptions<AcceptedQuote>,
): Promise<CustomerStatusChanged<AcceptedQuote> | CustomerStatusRefused | CustomerStatusGated> {
  const { storeId } = caller;
  const reservation = await readQuote(caller, reservationId);
  if (!reservation) return { ok: false, error: "reservationNotFound" };
  if (reservation.status !== "quote") return { ok: false, error: "invalidStatus" };

  // The read above checked the customer. A reservation's customer never changes,
  // so the store scope of the lock is enough.
  let effects: ReservationBillingEffect[] | null = null;
  try {
    // The quote's products, then the quote (DL-12). A lost deadlock or a
    // product added meanwhile runs the whole transaction again; it holds no
    // effect, so the session, the fee and the messages come once, after it.
    effects = await runReservationChange({ reservationId, storeId }, async (tx, lock) => {
      const change = await changeReservationStatus(tx, {
        lock,
        reservationId,
        storeId,
        to: "confirmed",
        actor: "customer",
        actorUserId: null,
        expectedFrom: "quote",
        beforeWrite: () => checkExistingReservationInventory(tx, reservationId, storeId),
        activity: { type: "quote_accepted", metadata: { source: "quote_acceptance" } },
      });
      if (!change.changed) return null;

      await validateReservationContract(tx, reservationId, storeId, "quote_acceptance");
      return change.effects;
    });
  } catch (error) {
    // Busy on every run: nothing was written, the customer can try again.
    if (isReservationChangeBusyError(error)) return { ok: false, error: "tryAgain" };
    // The stock refusal's key: it names no unit and no shortfall.
    if (error instanceof ConsumableStockError || error instanceof ReservationInventoryError) {
      return { ok: false, error: error.message };
    }
    // The card gate (README §8.4): the caller answers the renter without a reason.
    if (isStoreNotAcceptingReservationsError(error)) return { ok: false, gate: error };
    throw error;
  }
  if (!effects) return { ok: false, error: "invalidStatus" };

  await attemptFee(caller, effects, reservation, options);
  return { ok: true, changed: true, reservation };
}

async function declineQuote(
  caller: CustomerStatusChangeCaller,
  reservationId: string,
  options: CustomerStatusChangeOptions<DeclinedQuote>,
): Promise<CustomerStatusChanged<DeclinedQuote> | CustomerStatusRefused> {
  const { storeId } = caller;
  const reservation = await readDeclinedQuote(caller, reservationId);
  if (!reservation) return { ok: false, error: "reservationNotFound" };
  if (reservation.status !== "quote") return { ok: false, error: "invalidStatus" };

  // Under the lock, so a quote the store confirmed meanwhile is not declined. A
  // declined quote gives back no stock: the reservation's lock is enough. A lost
  // deadlock runs the whole transaction again (DL-12).
  let effects: ReservationBillingEffect[] | null;
  try {
    effects = await runReservationOnlyChange({ reservationId, storeId }, async (tx, lock) => {
      const change = await changeReservationStatus(tx, {
        lock,
        reservationId,
        storeId,
        to: "declined",
        actor: "customer",
        actorUserId: null,
        expectedFrom: "quote",
        activity: { type: "quote_declined", metadata: { source: "quote_decline" } },
      });
      return change.changed ? change.effects : null;
    });
  } catch (error) {
    // Busy on every run: nothing was written, the customer can try again.
    if (isReservationChangeBusyError(error)) return { ok: false, error: "tryAgain" };
    throw error;
  }
  if (!effects) return { ok: false, error: "invalidStatus" };

  await attemptFee(caller, effects, reservation, options);
  return { ok: true, changed: true, reservation };
}

/** The cancellation's transaction: a refusal's key, or what changed and its fee effects. */
type CancellationOutcome =
  | { error: string }
  | { changed: boolean; effects: ReservationBillingEffect[] };

async function cancelRequest(
  caller: CustomerStatusChangeCaller,
  reservationId: string,
  acknowledgePayment: boolean,
  options: CustomerStatusChangeOptions<CancelledRequest>,
): Promise<
  CustomerStatusChanged<CancelledRequest> | CustomerStatusUnchanged | CustomerStatusRefused
> {
  const { storeId } = caller;
  const scope = customerScope(caller, reservationId);
  const reservation = await readRequest(caller, reservationId);
  if (!reservation) return { ok: false, error: "reservationNotFound" };

  // A pending request gives back no stock: the reservation's lock is enough. A
  // lost deadlock runs the whole transaction again (DL-12).
  const cancellation = runReservationOnlyChange(
    { reservationId: reservation.id, storeId },
    async (tx, lock): Promise<CancellationOutcome> => {
      const [locked] = await tx
        .select({ status: reservations.status })
        .from(reservations)
        .where(scope)
        .for("update");
      if (!locked) return { error: "reservationNotFound" };
      if (locked.status === "cancelled") return { changed: false, effects: [] };
      if (locked.status !== "pending") return { error: "requestCancellationStatusChanged" };

      const paymentRows = await tx
        .select({ status: payments.status, method: payments.method, type: payments.type })
        .from(payments)
        .where(eq(payments.reservationId, reservation.id))
        .for("update");
      // A checkout can still settle asynchronously. Leave its reservation intact. A
      // deposit hold the store asked for and Stripe has not confirmed is no checkout.
      if (
        paymentRows.some(
          (payment) =>
            payment.method === "stripe" &&
            payment.status === "pending" &&
            payment.type !== "deposit_hold",
        )
      ) {
        return { error: "requestCancellationPaymentPending" };
      }
      if (
        !acknowledgePayment &&
        paymentRows.some((payment) => ["completed", "authorized"].includes(payment.status))
      ) {
        return { error: "requestCancellationPaymentChanged" };
      }
      const change = await changeReservationStatus(tx, {
        lock,
        reservationId: reservation.id,
        storeId,
        to: "cancelled",
        actor: "customer",
        actorUserId: null,
        expectedFrom: "pending",
        activity: { metadata: { source: "customer_request_cancellation" } },
      });
      // The row is locked above, so this cannot happen. It narrows the type.
      if (!change.changed) return { error: "requestCancellationStatusChanged" };
      return { changed: true, effects: change.effects };
    },
  );
  const result = await cancellation.catch((error: unknown): CancellationOutcome => {
    // Busy on every run: nothing was written, the customer can try again.
    if (isReservationChangeBusyError(error)) return { error: "tryAgain" };
    throw error;
  });
  if ("error" in result) return { ok: false, error: result.error };

  // Already cancelled: the run of no effects, as before; nothing else.
  await attemptFee(caller, result.effects, result.changed ? reservation : null, options);
  return result.changed ? { ok: true, changed: true, reservation } : { ok: true, changed: false };
}
