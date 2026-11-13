import {
  ConsumableStockError,
  assertStoreCanTakeReservations,
  canTransitionReservationStatus,
  changeReservationStatus,
  getAllowedReservationStatusTransitions,
  isReservationChangeBusyError,
  isStoreNotAcceptingReservationsError,
  payments,
  requiresReservationGate,
  reservationItems,
  reservations,
  runReservationChange,
  customers,
  stores,
  type ReservationActor,
  type ReservationBillingEffect,
  type ReservationStatus,
  type Transaction,
} from "@louez/db";
import {
  STORE_NOT_ACCEPTING_RESERVATIONS_ERROR,
  withCustomerNotificationDefaults,
  type CustomerNotificationSettings,
} from "@louez/types";
import { evaluateReservationRules, getSettledPaymentAmount } from "@louez/utils";
import { and, asc, eq } from "drizzle-orm";

import {
  describeShortfallLine,
  reservationErrors,
  type CapacityShortfall,
  type StatusChangeOutput,
} from "../contracts/reservations";
import type { Credential, Transport } from "../platform/actor";
import { sha256, stableStringify } from "../platform/hash";
import { amendEffectPayload, enqueueEffects, supersedeEffects } from "../platform/effects";
import type { ApiEvent, ApiEventStore, ApiPorts } from "../platform/ports";
import { resolveDateChangeRequests } from "./date-change-requests";
import {
  CUSTOMER_STATUS_NOTIFICATION,
  SUPERSEDED_CUSTOMER_MESSAGES,
  buildStatusChangeEffects,
  customerMessageKeyPrefix,
  type CustomerStatusMessage,
  type StatusChangeSnapshot,
} from "./reservation-effects";
import { validateReservationContract } from "./reservation-contract-validation";
import {
  ReservationCapacityShortfallError,
  ReservationInventoryError,
  ReservationTurnoverBufferShortfallError,
  ReservationUnitConflictError,
  checkStoreConfirmationInventory,
} from "./reservation-inventory";

/**
 * A reservation status change the store asks for, from the dashboard's
 * status menu and cancel button, the API and agents: the transaction, its
 * confirmation, and its effects. The customer is told of an acceptance, a
 * rejection and a cancellation, on the channels the store's customer
 * notification settings give each; a cancellation the customer makes from
 * the online store never comes here.
 *
 * Lock order (docs/code-review/04-data-layer.md, DL-12): the owner entry
 * `runReservationChange` (packages/db) locks the reservation's products by
 * id, then the reservation, before any check, in a READ COMMITTED
 * transaction, so every read sees what committed before its lock. A product
 * added to the reservation while the change waited for the reservation, or a
 * lost deadlock, rolls the transaction back and starts it over, up to three
 * runs, then this answers RESERVATION_BUSY.
 */

/** Who changes the status, on which store, and where the effects go. */
export interface StatusChangeCaller {
  storeId: string;
  /** The signed-in user, recorded on the activity row. */
  userId: string | null;
  /**
   * The key or grant the call came with, recorded on a confirmation that
   * books over the stock or confirms past the turnover buffer.
   */
  credential: Pick<Credential, "kind" | "id">;
  transport: Transport;
  /** May read customers: the preview then names the customer. */
  customers: boolean;
  store: ApiEventStore;
  ports: Pick<ApiPorts, "afterCommit" | "runReservationEffects" | "insurance" | "dispatchEffects">;
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
  messages: Array<{ message: CustomerStatusMessage; channel: "email" | "sms" }>;
  /** The items leave the stock for these dates (a request or a quote is confirmed). */
  reducesAvailability: boolean;
  /**
   * A confirmation sent with `allowOverbooking`: the lines it books over the
   * stock, as the check under the locks found them (none when the stock
   * covers it). The confirmation binds them: a shortfall that grew since the
   * preview voids its token. Null without the flag.
   */
  overbooking: { shortfalls: CapacityShortfall[] } | null;
  /**
   * A confirmation sent with `overrideTurnoverBuffer`: the lines that fit the
   * stock but not the turnover buffer, confirmed past it, as the check under
   * the locks found them (none when the buffer stops none), and the buffer
   * they were checked with. The confirmation binds them, as it binds
   * `overbooking`. Null without the flag.
   */
  turnoverBuffer: { shortfalls: CapacityShortfall[]; turnoverBufferMinutes: number } | null;
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
   * A hash of where the messages go (each channel and its address) and of
   * their language, never shown: the confirmation binds it, so a changed
   * email, phone or language voids the token even when the preview could not
   * show them.
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
  /**
   * For a confirmation that takes stock: book over the returnable stock the
   * check finds short, on purpose (S3). Ignored for any other change.
   */
  allowOverbooking?: boolean;
  /**
   * For a confirmation that takes stock: confirm past the turnover buffer the
   * lines that fit the stock only without it, on purpose (S4). It covers
   * this change only (D5), never a capacity shortfall. Ignored for any other
   * change.
   */
  overrideTurnoverBuffer?: boolean;
}

/** Whether a change needs the caller's confirmation: a message to the customer, less stock, or a cancellation. */
export function statusChangeIsSensitive(from: ReservationStatus, to: ReservationStatus) {
  return to === "cancelled" || to === "rejected" || takesStock(from, to);
}

const takesStock = (from: ReservationStatus, to: ReservationStatus) =>
  to === "confirmed" && (from === "pending" || from === "quote");

/** The activity's actor: who asked, as the reservation's history shows it. */
const activityActor = (transport: Transport): ReservationActor =>
  transport === "rpc" ? "store_user" : transport === "mcp" ? "mcp" : "api";

/**
 * Reads what the change and its preview need, under the locks the owner
 * entry took: the reservation's products, then the reservation.
 */
async function readLockedReservation(tx: Transaction, reservationId: string, storeId: string) {
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
      subtotalAmount: reservations.subtotalAmount,
      depositAmount: reservations.depositAmount,
      taxRate: reservations.taxRate,
      subtotalExclTax: reservations.subtotalExclTax,
      taxAmount: reservations.taxAmount,
      locale: reservations.locale,
      signedAt: reservations.signedAt,
    })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)));
  if (!row) return null;

  // What the preview, its confirmation and the messages all show: read once
  // here, under the locks, and reused, so they cannot disagree. The customer
  // and the store are plain reads (outside the reservation writers' lock
  // order): a change to them after this read shows in the confirmation's
  // binding, never in a message that differs from the preview.
  const [[customer], [store], items] = await Promise.all([
    tx
      .select({
        id: customers.id,
        firstName: customers.firstName,
        lastName: customers.lastName,
        email: customers.email,
        phone: customers.phone,
      })
      .from(customers)
      .where(and(eq(customers.id, row.customerId), eq(customers.storeId, storeId)))
      .limit(1),
    tx
      .select({
        id: stores.id,
        userId: stores.userId,
        name: stores.name,
        slug: stores.slug,
        email: stores.email,
        phone: stores.phone,
        address: stores.address,
        logoUrl: stores.logoUrl,
        darkLogoUrl: stores.darkLogoUrl,
        theme: stores.theme,
        settings: stores.settings,
        emailSettings: stores.emailSettings,
        customerNotificationSettings: stores.customerNotificationSettings,
        cgv: stores.cgv,
      })
      .from(stores)
      .where(eq(stores.id, storeId)),
    tx
      .select({
        quantity: reservationItems.quantity,
        unitPrice: reservationItems.unitPrice,
        totalPrice: reservationItems.totalPrice,
        productSnapshot: reservationItems.productSnapshot,
      })
      .from(reservationItems)
      .where(eq(reservationItems.reservationId, reservationId))
      .orderBy(asc(reservationItems.createdAt), asc(reservationItems.id)),
  ]);
  if (!store) return null;
  const { cgv, ...storeFields } = store;
  const snapshot: StatusChangeSnapshot = {
    reservation: {
      id: row.id,
      number: row.number,
      startDate: row.startDate,
      endDate: row.endDate,
      totalAmount: row.totalAmount,
      subtotalAmount: row.subtotalAmount,
      depositAmount: row.depositAmount,
      taxRate: row.taxRate,
      subtotalExclTax: row.subtotalExclTax,
      taxAmount: row.taxAmount,
      locale: row.locale,
      currency: row.currency,
    },
    customer: customer ?? null,
    store: { ...storeFields, hasTerms: Boolean(cgv?.trim()) },
    items: items.map((item) => ({
      name: item.productSnapshot?.name || "Product",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    })),
  };
  return { ...row, customer: customer ?? null, snapshot };
}

type LockedReservation = NonNullable<Awaited<ReturnType<typeof readLockedReservation>>>;

/** The channels a customer message goes out on, as the store's notification settings say. */
function customerMessages(
  settings: CustomerNotificationSettings | null,
  message: CustomerStatusMessage,
  customer: { email: string; phone: string | null },
): StatusChangePreview["messages"] {
  const prefs = withCustomerNotificationDefaults(settings)[CUSTOMER_STATUS_NOTIFICATION[message]];
  if (!prefs.enabled) return [];
  return [
    ...(prefs.email && customer.email ? [{ message, channel: "email" as const }] : []),
    ...(prefs.sms && customer.phone ? [{ message, channel: "sms" as const }] : []),
  ];
}

const money = (amount: number) => (Math.round(amount * 100) / 100).toFixed(2);

/** The message a change sends the customer, if any. */
function customerMessageOf(
  from: ReservationStatus,
  to: ReservationStatus,
): CustomerStatusMessage | null {
  if (takesStock(from, to)) return "request_accepted";
  if (to === "rejected") return "request_rejected";
  if (to === "cancelled") return "reservation_cancelled";
  return null;
}

/** Each message as the preview names it. */
const MESSAGE_NAMES: Record<CustomerStatusMessage, string> = {
  request_accepted: "request accepted",
  request_rejected: "request rejected",
  reservation_cancelled: "reservation cancelled",
};

/** The shortfalls a confirmation books over, for its preview's sentence. */
const describeOverbooking = (shortfalls: readonly CapacityShortfall[]) =>
  shortfalls.length === 0
    ? "The stock covers it: nothing is booked over the stock."
    : `The stock cannot cover it, and it is booked over the stock all the same: ${shortfalls
        .map(
          (shortfall) =>
            `${describeShortfallLine(shortfall)}, ${shortfall.requested} asked, ${shortfall.available} free`,
        )
        .join("; ")}. The reservation's history records it.`;

/** The lines a confirmation takes past the turnover buffer, for its preview's sentence. */
const describeTurnoverBuffer = ({
  shortfalls,
  turnoverBufferMinutes,
}: NonNullable<StatusChangePreview["turnoverBuffer"]>) =>
  shortfalls.length === 0
    ? "The turnover buffer stops no line: nothing is confirmed past it."
    : `These lines fit the stock but not the ${turnoverBufferMinutes}-minute turnover buffer the store keeps between rentals, and are confirmed past it all the same: ${shortfalls
        .map(
          (shortfall) =>
            `${describeShortfallLine(shortfall)}, ${shortfall.requested} asked, ${shortfall.available} free with the buffer`,
        )
        .join("; ")}. The reservation's history records it.`;

async function buildPreview(
  tx: Transaction,
  caller: StatusChangeCaller,
  locked: LockedReservation,
  to: ReservationStatus,
  overrides: Pick<StatusChangePreview, "overbooking" | "turnoverBuffer">,
): Promise<StatusChangePreview> {
  const { overbooking, turnoverBuffer } = overrides;
  const { store } = locked.snapshot;
  const currency = locked.currency ?? store.settings?.currency ?? "EUR";
  const name = [locked.customer?.firstName, locked.customer?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const customer =
    caller.customers && locked.customer ? { name, email: locked.customer.email } : null;
  const who = customer ? `${customer.name} (${customer.email})` : "the customer";
  const period = `${locked.startDate.toISOString()} to ${locked.endDate.toISOString()}`;

  const message = customerMessageOf(locked.status, to);
  const messages =
    message && locked.customer
      ? customerMessages(store.customerNotificationSettings, message, locked.customer)
      : [];
  const sends =
    message && messages.length > 0
      ? `${who} gets the "${MESSAGE_NAMES[message]}" message by ${messages.map((entry) => entry.channel).join(" and ")}.`
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
    turnoverBuffer ? describeTurnoverBuffer(turnoverBuffer) : null,
    overbooking ? describeOverbooking(overbooking.shortfalls) : null,
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
    overbooking,
    turnoverBuffer,
    money: moneyFacts,
    insuranceContract,
    // Where the messages go, and in which language.
    recipientsHash: sha256(
      stableStringify({
        locale: locked.locale,
        recipients: messages.map((entry) => ({
          channel: entry.channel,
          to: entry.channel === "email" ? locked.customer?.email : locked.customer?.phone,
        })),
      }),
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
      /** The outbox rows of the change; the last is its analytics event. */
      effectIds: string[];
    };

/**
 * Changes a reservation's status, as the store asks: confirm, reject, pick
 * up, return or cancel. A confirmation with lines that fit the stock but not
 * the turnover buffer is refused with them
 * (RESERVATION_TURNOVER_BUFFER_CONFLICT) unless the request carries
 * `overrideTurnoverBuffer`; one the returnable stock cannot cover, with its
 * shortfalls (RESERVATION_INSUFFICIENT_CAPACITY) unless it carries
 * `allowOverbooking`. Neither flag passes the other's shortfalls. Passed, the
 * change is made, and its activity row records what each flag passed and
 * the credential. A held unit another booking holds or needs, and consumable
 * stock below zero, refuse whatever the flags. `confirm` is asked under the
 * locks when the change sends the customer a message, takes stock, or
 * cancels; its preview lists what each flag passes. The
 * customer's message, the store's and the platform's notifications and the
 * analytics event go to the outbox in the same transaction. Then, once
 * committed: the fee, the insurance contract, the outbox's dispatch and the
 * revalidation.
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
    outcome = await runReservationChange(
      { reservationId: id, storeId },
      async (tx, lock): Promise<TransactionOutcome> => {
        const locked = await readLockedReservation(tx, id, storeId);
        if (!locked) return { kind: "not_found" };
        const from = locked.status;
        if (from === to || !canTransitionReservationStatus(from, to)) {
          return { kind: "refused", error: refusalError(locked, to) };
        }
        const pickedUpUnsigned = to === "ongoing" && !locked.signedAt;
        if (
          pickedUpUnsigned &&
          locked.snapshot.store.settings?.contractSignatureMode === "required"
        ) {
          return { kind: "refused", error: reservationErrors.contractUnsigned(id) };
        }

        // Checks before the confirmation, so a caller is never asked to
        // confirm what cannot happen: the card gate, then the stock.
        if (requiresReservationGate(from, to, actor)) {
          await assertStoreCanTakeReservations(tx, storeId);
        }
        // A change that takes stock is checked here, before the preview; its
        // verdict goes on the change's activity row, through `beforeWrite`.
        // Short stock, or a short turnover buffer, refuses unless the store
        // passes it on purpose, each with its own flag.
        const allowOverbooking = takesStock(from, to) && request.allowOverbooking === true;
        const overrideTurnoverBuffer =
          takesStock(from, to) && request.overrideTurnoverBuffer === true;
        const inventory = takesStock(from, to)
          ? await checkStoreConfirmationInventory(tx, id, storeId, {
              allowOverbooking,
              overrideTurnoverBuffer,
            })
          : null;
        const bookedOver = inventory?.bookedOver ?? [];
        const pastBuffer = inventory?.pastBuffer ?? [];

        // The preview, its confirmation and the queued messages share one snapshot.
        const preview = await buildPreview(tx, caller, locked, to, {
          overbooking: allowOverbooking ? { shortfalls: bookedOver } : null,
          turnoverBuffer:
            inventory && overrideTurnoverBuffer
              ? { shortfalls: pastBuffer, turnoverBufferMinutes: inventory.turnoverBufferMinutes }
              : null,
        });
        if (options.confirm && statusChangeIsSensitive(from, to)) {
          const refusal = await options.confirm(preview, tx);
          // Committed: the new preview stays recorded for its token.
          if (refusal) return { kind: "confirm", error: refusal };
        }

        const warnings =
          to === "confirmed"
            ? evaluateReservationRules({
                startDate: locked.startDate,
                endDate: locked.endDate,
                storeSettings: locked.snapshot.store.settings,
              })
            : [];
        const change = await changeReservationStatus(tx, {
          lock,
          reservationId: id,
          storeId,
          to,
          actor,
          actorUserId: caller.userId,
          expectedFrom: from,
          beforeWrite: inventory
            ? async () => ({
                activityAt: inventory.activityAt,
                activityMetadata: {
                  ...inventory.activityMetadata,
                  // Booked over the stock, or confirmed past the buffer: by
                  // which key or grant, next to the actor.
                  ...(bookedOver.length > 0 || pastBuffer.length > 0
                    ? { credential: { kind: caller.credential.kind, id: caller.credential.id } }
                    : {}),
                },
              })
            : undefined,
          activity: {
            metadata: {
              ...(to === "rejected" && request.rejectionReason
                ? { rejectionReason: request.rejectionReason }
                : {}),
              // Handed over before the customer accepted the contract: kept in the history.
              ...(pickedUpUnsigned ? { contractUnsigned: true } : {}),
              ...(warnings.length > 0
                ? { validationWarnings: warnings, validationWarningsCount: warnings.length }
                : {}),
            },
          },
        });
        // The reservation is locked since the owner entry took it: it cannot have moved.
        if (!change.changed) return { kind: "refused", error: refusalError(locked, to) };

        // It does nothing unless the reservation is now billable and not yet signed.
        await validateReservationContract(tx, id, storeId, "confirmation");
        await resolveDateChangeRequests(tx, id, locked.startDate, locked.endDate, change.to);
        // An earlier change's unsent customer messages this one makes false.
        const superseded = SUPERSEDED_CUSTOMER_MESSAGES[change.to];
        if (superseded) {
          await supersedeEffects(tx, storeId, customerMessageKeyPrefix(id), {
            field: "notification",
            values: superseded,
          });
        }
        const effectIds = await enqueueEffects(
          tx,
          storeId,
          buildStatusChangeEffects(locked.snapshot, {
            from: change.from,
            to: change.to,
            transport: caller.transport,
            rejectionReason: request.rejectionReason ?? null,
            warningCount: warnings.length,
            messages: preview.messages,
          }),
        );
        return {
          kind: "changed",
          locked,
          from: change.from,
          to: change.to,
          effects: change.effects,
          warnings: warnings.map(({ key, params }) => ({ key, ...(params ? { params } : {}) })),
          effectIds,
        };
      },
    );
  } catch (error) {
    if (isReservationChangeBusyError(error)) throw reservationErrors.busy(id);
    if (error instanceof ReservationUnitConflictError) {
      throw reservationErrors.unitsUnavailable(error.conflicts);
    }
    if (error instanceof ReservationCapacityShortfallError) {
      throw reservationErrors.insufficientCapacity(error.shortfalls);
    }
    if (error instanceof ReservationTurnoverBufferShortfallError) {
      throw reservationErrors.turnoverBufferShortfall(error.shortfalls);
    }
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

  const analyticsId = outcome.effectIds.at(-1);
  if (analyticsId && warnings.length !== outcome.warnings.length) {
    await amendEffectPayload(analyticsId, "warningCount", warnings.length).catch(() => {});
  }
  try {
    caller.ports.dispatchEffects(outcome.effectIds);
  } catch (error) {
    // The rows stay pending: the cron sends them.
    console.error("Dispatching the effects of a status change failed:", error);
  }
  emit(caller, { type: "reservation.statusChanged", store: caller.store, reservationId: id });

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
