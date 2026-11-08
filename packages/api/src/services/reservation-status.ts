import {
  ConsumableStockError,
  assertStoreCanTakeReservations,
  canTransitionReservationStatus,
  changeReservationStatus,
  db,
  getAllowedReservationStatusTransitions,
  isDatabaseDeadlock,
  isStoreNotAcceptingReservationsError,
  payments,
  products,
  requiresReservationGate,
  reservationItems,
  reservations,
  retryTransactionOnDeadlock,
  customers,
  type ReservationActor,
  type ReservationBillingEffect,
  type ReservationStatus,
  type Transaction,
} from "@louez/db";
import {
  DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
  STORE_NOT_ACCEPTING_RESERVATIONS_ERROR,
  type CustomerNotificationSettings,
  type StoreSettings,
} from "@louez/types";
import { evaluateReservationRules, getSettledPaymentAmount } from "@louez/utils";
import { and, asc, eq, inArray } from "drizzle-orm";

import { reservationErrors, type StatusChangeOutput } from "../contracts/reservations";
import type { Transport } from "../platform/actor";
import { sha256, stableStringify } from "../platform/hash";
import type { ApiEvent, ApiEventStore, ApiPorts } from "../platform/ports";
import { resolveDateChangeRequests } from "./date-change-requests";
import { validateReservationContract } from "./reservation-contract-validation";
import {
  ReservationInventoryError,
  checkExistingReservationInventory,
} from "./reservation-inventory";

/**
 * A reservation status change the store asks for, from the dashboard's
 * status menu and cancel button, the API and agents: the transaction, its
 * confirmation, and its effects.
 *
 * Lock order (docs/code-review/04-data-layer.md, DL-12): the reservation's
 * products by id, then the reservation, before any check. The transaction
 * runs READ COMMITTED, so every read sees what committed before its lock. A
 * product added to the reservation while the change waited for the
 * reservation was never locked: the transaction rolls back and starts over,
 * up to three runs, then answers RESERVATION_BUSY.
 */

/** Who changes the status, on which store, and where the effects go. */
export interface StatusChangeCaller {
  storeId: string;
  /** The signed-in user, recorded on the activity row. */
  userId: string | null;
  transport: Transport;
  /** May read customers: the preview then names the customer. */
  customers: boolean;
  store: ApiEventStore & {
    settings: StoreSettings | null;
    customerNotificationSettings: CustomerNotificationSettings | null;
  };
  ports: Pick<ApiPorts, "afterCommit" | "runReservationEffects" | "insurance">;
}

/** What a status change will do, under its locks, for its confirmation. */
export interface StatusChangePreview {
  summary: string;
  reservation: {
    id: string;
    number: string;
    from: ReservationStatus;
    to: ReservationStatus;
    startDate: string;
    endDate: string;
    totalAmount: string;
    currency: string;
  };
  /** Null when the caller may not read customers. */
  customer: { name: string; email: string } | null;
  /** The messages the customer gets: which, and on which channel. */
  messages: Array<{ message: "request_accepted" | "request_rejected"; channel: "email" | "sms" }>;
  /** The items leave the stock for these dates (a request or a quote is confirmed). */
  reducesAvailability: boolean;
  /** For a cancellation: what was paid, and what happens to it. */
  money: {
    rentalPaid: string;
    depositCollected: string;
    depositStatus: string | null;
    /** A cancellation never refunds or releases anything by itself. */
    refundedAutomatically: false;
  } | null;
  /** The insurance contract the change creates or cancels. */
  insuranceContract: "created" | "cancelled" | null;
  /**
   * A hash of where the messages go (each channel and its address), never
   * shown: the confirmation binds it, so a changed email or phone voids the
   * token even when the preview could not show them.
   */
  recipientsHash: string;
}

/** Asks the caller to confirm, under the change's locks: null goes on, an error stops. */
export type StatusConfirmStep = (
  preview: StatusChangePreview,
  tx: Transaction,
) => Promise<Error | null>;

export interface StatusChangeRequest {
  id: string;
  to: ReservationStatus;
  /** Kept only for a rejection. */
  rejectionReason?: string;
}

/** Whether a change needs the caller's confirmation: a message to the customer, less stock, or a cancellation. */
export function statusChangeIsSensitive(from: ReservationStatus, to: ReservationStatus) {
  return to === "cancelled" || to === "rejected" || takesStock(from, to);
}

const takesStock = (from: ReservationStatus, to: ReservationStatus) =>
  to === "confirmed" && (from === "pending" || from === "quote");

/**
 * The reservation got a product while its status change waited for its lock
 * (an edit added a line): that product is not locked, and locking it now,
 * behind the reservation, would invert the lock order. The transaction rolls
 * back and starts over.
 */
export class ReservationProductsChangedError extends Error {
  constructor(readonly reservationId: string) {
    super("The reservation's products changed while its status change waited for it.");
    this.name = "ReservationProductsChangedError";
  }
}

/** Most runs of a status change: a deadlock or new products start it over. */
const STATUS_CHANGE_ATTEMPTS = 3;

const isConflict = (error: unknown) =>
  isDatabaseDeadlock(error) || error instanceof ReservationProductsChangedError;

/** The activity's actor: who asked, as the reservation's history shows it. */
const activityActor = (transport: Transport): ReservationActor =>
  transport === "rpc" ? "store_user" : transport === "mcp" ? "mcp" : "api";

/** The ids of the reservation's products, sorted. A plain read: the transaction runs READ COMMITTED. */
async function reservationProductIds(tx: Transaction, reservationId: string, storeId: string) {
  const lines = await tx
    .selectDistinct({ productId: reservationItems.productId })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(eq(reservationItems.reservationId, reservationId), eq(reservations.storeId, storeId)),
    );
  return lines.flatMap((line) => (line.productId ? [line.productId] : [])).sort();
}

/**
 * Locks the reservation's products, by id, then the reservation, and reads
 * what the change and its preview need under those locks. Restarts when a
 * product joined the reservation in between.
 */
async function lockReservation(tx: Transaction, reservationId: string, storeId: string) {
  const productIds = await reservationProductIds(tx, reservationId, storeId);
  if (productIds.length > 0) {
    await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
      .orderBy(asc(products.id))
      .for("update");
  }

  const [row] = await tx
    .select({
      id: reservations.id,
      number: reservations.number,
      status: reservations.status,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
      totalAmount: reservations.totalAmount,
      currency: reservations.currency,
      depositStatus: reservations.depositStatus,
      tulipInsuranceOptIn: reservations.tulipInsuranceOptIn,
      tulipContractId: reservations.tulipContractId,
      customerId: reservations.customerId,
    })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)))
    .for("update");
  if (!row) return null;

  const current = await reservationProductIds(tx, reservationId, storeId);
  if (current.some((productId) => !productIds.includes(productId))) {
    throw new ReservationProductsChangedError(reservationId);
  }

  // A plain read, not locked: customers are outside the reservation writers' lock order.
  const [customer] = await tx
    .select({
      firstName: customers.firstName,
      lastName: customers.lastName,
      email: customers.email,
      phone: customers.phone,
    })
    .from(customers)
    .where(and(eq(customers.id, row.customerId), eq(customers.storeId, storeId)))
    .limit(1);
  return { ...row, customer: customer ?? null };
}

type LockedReservation = NonNullable<Awaited<ReturnType<typeof lockReservation>>>;

/** The channels a customer message goes out on, as the store's notification settings say. */
function customerMessages(
  settings: CustomerNotificationSettings | null,
  message: "request_accepted" | "request_rejected",
  customer: { email: string; phone: string | null },
): StatusChangePreview["messages"] {
  const event =
    message === "request_accepted" ? "customer_request_accepted" : "customer_request_rejected";
  const prefs =
    (settings ?? DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS)[event] ??
    DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS[event];
  if (!prefs.enabled) return [];
  return [
    ...(prefs.email && customer.email ? [{ message, channel: "email" as const }] : []),
    ...(prefs.sms && customer.phone ? [{ message, channel: "sms" as const }] : []),
  ];
}

const money = (amount: number) => (Math.round(amount * 100) / 100).toFixed(2);

async function buildPreview(
  tx: Transaction,
  caller: StatusChangeCaller,
  locked: LockedReservation,
  to: ReservationStatus,
): Promise<StatusChangePreview> {
  const currency = locked.currency ?? caller.store.settings?.currency ?? "EUR";
  const name = [locked.customer?.firstName, locked.customer?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const customer =
    caller.customers && locked.customer ? { name, email: locked.customer.email } : null;
  const who = customer ? `${customer.name} (${customer.email})` : "the customer";
  const period = `${locked.startDate.toISOString()} to ${locked.endDate.toISOString()}`;

  const message = takesStock(locked.status, to)
    ? ("request_accepted" as const)
    : to === "rejected"
      ? ("request_rejected" as const)
      : null;
  const messages =
    message && locked.customer
      ? customerMessages(caller.store.customerNotificationSettings, message, locked.customer)
      : [];
  const sends =
    message && messages.length > 0
      ? `${who} gets the "${message === "request_accepted" ? "request accepted" : "request rejected"}" message by ${messages.map((entry) => entry.channel).join(" and ")}.`
      : "No message goes to the customer.";

  let moneyFacts: StatusChangePreview["money"] = null;
  if (to === "cancelled") {
    const rows = await tx
      .select({
        id: payments.id,
        type: payments.type,
        status: payments.status,
        amount: payments.amount,
        refundOfPaymentId: payments.refundOfPaymentId,
        stripeRefundId: payments.stripeRefundId,
        stripePaymentIntentId: payments.stripePaymentIntentId,
        stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
      })
      .from(payments)
      .where(eq(payments.reservationId, locked.id));
    const deposit =
      getSettledPaymentAmount(rows, "deposit") - getSettledPaymentAmount(rows, "deposit_return");
    moneyFacts = {
      rentalPaid: money(getSettledPaymentAmount(rows, "rental")),
      depositCollected: money(Math.max(0, deposit)),
      depositStatus: locked.depositStatus,
      refundedAutomatically: false,
    };
  }

  const insuranceContract =
    takesStock(locked.status, to) && locked.tulipInsuranceOptIn
      ? "created"
      : to === "cancelled" && locked.tulipContractId
        ? "cancelled"
        : null;

  const reservationLabel = `reservation #${locked.number}${customer ? ` for ${customer.name}` : ""} (${period}, ${locked.totalAmount} ${currency})`;
  const summary = [
    to === "cancelled"
      ? `Cancel ${reservationLabel}.`
      : to === "rejected"
        ? `Reject ${reservationLabel}.`
        : `Change ${reservationLabel} from ${locked.status} to ${to}.`,
    sends,
    takesStock(locked.status, to) ? "Its items leave the stock for these dates." : null,
    moneyFacts
      ? `Paid so far: ${moneyFacts.rentalPaid} ${currency} for the rental, ${moneyFacts.depositCollected} ${currency} of deposit (deposit status ${moneyFacts.depositStatus ?? "none"}). Nothing is refunded or released by the cancellation: refund from the reservation's payments.`
      : null,
    to === "cancelled" ? "The store's own notifications go out as set." : null,
    insuranceContract === "created" ? "The insurance contract is created." : null,
    insuranceContract === "cancelled" ? "The insurance contract is cancelled." : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    summary,
    reservation: {
      id: locked.id,
      number: locked.number,
      from: locked.status,
      to,
      startDate: locked.startDate.toISOString(),
      endDate: locked.endDate.toISOString(),
      totalAmount: locked.totalAmount,
      currency,
    },
    customer,
    messages,
    reducesAvailability: takesStock(locked.status, to),
    money: moneyFacts,
    insuranceContract,
    recipientsHash: sha256(
      stableStringify(
        messages.map((entry) => ({
          channel: entry.channel,
          to: entry.channel === "email" ? locked.customer?.email : locked.customer?.phone,
        })),
      ),
    ),
  };
}

/** Why a change was refused, as the contract's error. */
function refusalError(locked: LockedReservation, to: ReservationStatus) {
  if (to === "cancelled") return reservationErrors.notCancellable(locked.status);
  return reservationErrors.transitionNotAllowed(locked.status, to, [
    ...getAllowedReservationStatusTransitions(locked.status),
  ]);
}

type TransactionOutcome =
  | { kind: "not_found" }
  | { kind: "refused"; error: Error }
  | { kind: "confirm"; error: Error }
  | {
      kind: "changed";
      locked: LockedReservation;
      from: ReservationStatus;
      to: ReservationStatus;
      effects: ReservationBillingEffect[];
      warnings: StatusChangeOutput["warnings"];
    };

/**
 * Changes a reservation's status, as the store asks: confirm, reject, pick
 * up, return or cancel. `confirm` is asked under the locks when the change
 * sends the customer a message, takes stock, or cancels. Then, once
 * committed: the fee, the insurance contract, and the app's effects (the
 * customer's message, the store's notifications, analytics, revalidation).
 */
export async function changeStoreReservationStatus(
  caller: StatusChangeCaller,
  request: StatusChangeRequest,
  options: { confirm?: StatusConfirmStep } = {},
): Promise<StatusChangeOutput> {
  const { storeId } = caller;
  const { id, to } = request;
  const actor = activityActor(caller.transport);

  let outcome: TransactionOutcome;
  try {
    outcome = await retryTransactionOnDeadlock(
      () =>
        db.transaction(
          async (tx): Promise<TransactionOutcome> => {
            const locked = await lockReservation(tx, id, storeId);
            if (!locked) return { kind: "not_found" };
            const from = locked.status;
            if (from === to || !canTransitionReservationStatus(from, to)) {
              return { kind: "refused", error: refusalError(locked, to) };
            }

            // Checks before the confirmation, so a caller is never asked to
            // confirm what cannot happen: the card gate, then the stock.
            if (requiresReservationGate(from, to, actor)) {
              await assertStoreCanTakeReservations(tx, storeId);
            }
            if (takesStock(from, to)) {
              await checkExistingReservationInventory(tx, id, storeId);
            }

            if (options.confirm && statusChangeIsSensitive(from, to)) {
              const refusal = await options.confirm(await buildPreview(tx, caller, locked, to), tx);
              // Committed: the new preview stays recorded for its token.
              if (refusal) return { kind: "confirm", error: refusal };
            }

            const warnings =
              to === "confirmed"
                ? evaluateReservationRules({
                    startDate: locked.startDate,
                    endDate: locked.endDate,
                    storeSettings: caller.store.settings,
                  })
                : [];
            const change = await changeReservationStatus(tx, {
              reservationId: id,
              storeId,
              to,
              actor,
              actorUserId: caller.userId,
              expectedFrom: from,
              activity: {
                metadata: {
                  ...(to === "rejected" && request.rejectionReason
                    ? { rejectionReason: request.rejectionReason }
                    : {}),
                  ...(warnings.length > 0
                    ? { validationWarnings: warnings, validationWarningsCount: warnings.length }
                    : {}),
                },
              },
            });
            // The reservation is locked since lockReservation: it cannot have moved.
            if (!change.changed) return { kind: "refused", error: refusalError(locked, to) };

            // It does nothing unless the reservation is now billable and not yet signed.
            await validateReservationContract(tx, id, storeId, "confirmation");
            await resolveDateChangeRequests(tx, id, locked.startDate, locked.endDate, change.to);
            return {
              kind: "changed",
              locked,
              from: change.from,
              to: change.to,
              effects: change.effects,
              warnings: warnings.map(({ key, params }) => ({ key, ...(params ? { params } : {}) })),
            };
          },
          { isolationLevel: "read committed" },
        ),
      { attempts: STATUS_CHANGE_ATTEMPTS, retryOn: isConflict },
    );
  } catch (error) {
    if (isConflict(error)) throw reservationErrors.busy(id);
    if (error instanceof ConsumableStockError || error instanceof ReservationInventoryError) {
      throw error.message === "errors.reservationNotFound"
        ? reservationErrors.notFound(id)
        : reservationErrors.itemsUnavailable(error.message);
    }
    if (isStoreNotAcceptingReservationsError(error)) {
      emit(caller, {
        type: "reservation.gateRefused",
        store: caller.store,
        transport: caller.transport,
        reason: error.reason,
      });
      throw reservationErrors.storeNotAccepting(STORE_NOT_ACCEPTING_RESERVATIONS_ERROR);
    }
    throw error;
  }

  if (outcome.kind === "not_found") throw reservationErrors.notFound(id);
  if (outcome.kind !== "changed") throw outcome.error;

  // Right after commit: the pay-as-you-go fee is recorded or voided.
  await caller.ports.runReservationEffects(outcome.effects);

  const warnings = [...outcome.warnings];
  if (takesStock(outcome.from, outcome.to)) {
    const contractWarning = await caller.ports.insurance.createContract(id);
    if (contractWarning) warnings.push(contractWarning);
  } else if (outcome.to === "cancelled" && outcome.locked.tulipContractId) {
    await caller.ports.insurance.cancelContract(id);
  }

  emit(caller, {
    type: "reservation.statusChanged",
    store: caller.store,
    transport: caller.transport,
    reservationId: id,
    from: outcome.from,
    to: outcome.to,
    rejectionReason: outcome.to === "rejected" ? (request.rejectionReason ?? null) : null,
    warningCount: warnings.length,
  });

  return {
    id,
    number: outcome.locked.number,
    from: outcome.from,
    to: outcome.to,
    warnings,
  };
}

/** An effect must never fail a write that has committed. */
function emit(caller: StatusChangeCaller, event: ApiEvent) {
  try {
    caller.ports.afterCommit(event);
  } catch (error) {
    console.error("A reservation effect failed after its commit:", error);
  }
}
