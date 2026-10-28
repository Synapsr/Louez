import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  canTransitionReservationStatus,
  consumeReservationStock,
  getAllowedReservationStatusTransitions,
  restoreReservationStock,
} from "./consumable-stock";
import { markReservation } from "./billing-queue";
import type { Transaction } from "./index";
import { assertStoreCanTakeReservations } from "./reservation-gate";
import { reservationActivity, reservations } from "./schema";

export type ReservationStatus = (typeof reservations.$inferSelect)["status"];
export type ReservationActivityType = (typeof reservationActivity.$inferInsert)["activityType"];

/** The statuses a reservation is billed for. */
export const BILLABLE_RESERVATION_STATUSES = [
  "confirmed",
  "ongoing",
  "completed",
] as const satisfies readonly ReservationStatus[];

const billableStatuses: readonly ReservationStatus[] = BILLABLE_RESERVATION_STATUSES;

export function isBillableReservationStatus(status: ReservationStatus): boolean {
  return billableStatuses.includes(status);
}

/** Who asks for a status change. `payment` only means "a completed payment confirms it". */
export const RESERVATION_ACTORS = [
  "store_user",
  "customer",
  "payment",
  "system",
  "ai_chat",
  "mcp",
  "marketplace",
] as const;
export type ReservationActor = (typeof RESERVATION_ACTORS)[number];

/**
 * What billing must do once the transaction has committed. An effect is an
 * intent: the runner decides whether billing applies to the store.
 */
export type ReservationBillingEffect =
  | {
      type: "legacy_fee.record";
      storeId: string;
      reservationId: string;
      marketplace: boolean;
      at: Date;
    }
  | { type: "legacy_fee.void"; storeId: string; reservationId: string };

export type ReservationEffectRunner = (
  effects: readonly ReservationBillingEffect[],
) => Promise<void>;

export interface ChangeReservationStatusInput {
  reservationId: string;
  storeId: string;
  to: ReservationStatus;
  actor: ReservationActor;
  /** The signed-in user who asked. Null for customers and automatic changes. */
  actorUserId: string | null;
  /** Refuse unless the locked status is one of these (stale-read and compare-and-set guards). */
  expectedFrom?: ReservationStatus | readonly ReservationStatus[];
  /** Runs after the lock and the checks, before stock and the update. Errors propagate. */
  beforeWrite?: (
    tx: Transaction,
    change: { from: ReservationStatus; to: ReservationStatus },
  ) => Promise<void>;
  /** The activity row, written in the same transaction. */
  activity?: {
    type?: ReservationActivityType;
    metadata?: Record<string, unknown>;
    description?: string | null;
  };
  /** Tests only. */
  now?: Date;
}

export type ReservationStatusRefusal = "already_in_target" | "unexpected_status" | "not_allowed";

export type ChangeReservationStatusResult =
  | {
      changed: true;
      from: ReservationStatus;
      to: ReservationStatus;
      effects: ReservationBillingEffect[];
    }
  | { changed: false; from: null; reason: "not_found" }
  | { changed: false; from: ReservationStatus; reason: ReservationStatusRefusal };

/** What the assistant and MCP tools answer when a change is refused. */
export function invalidReservationTransitionMessage(
  from: ReservationStatus,
  to: ReservationStatus,
): string {
  const allowed = getAllowedReservationStatusTransitions(from);
  return `Invalid transition: ${from} → ${to}. Allowed: ${allowed.length > 0 ? allowed.join(", ") : "none"}`;
}

/** The locked reservation, as the plan reads it. */
export interface LockedReservation {
  status: ReservationStatus;
  source: string | null;
  billableAt: Date | null;
}

export type PlanReservationStatusChangeInput = Omit<
  ChangeReservationStatusInput,
  "beforeWrite" | "now"
> & { now: Date };

export type ReservationStatusChangePlan =
  | { changed: false; reason: ReservationStatusRefusal }
  | {
      changed: true;
      stock: "consume" | "restore" | null;
      /** An absent key leaves its column as it is. */
      update: {
        status: ReservationStatus;
        updatedAt: Date;
        billableAt?: Date;
        withdrawnAt?: Date;
        pickedUpAt?: Date;
        returnedAt?: Date;
      };
      activity: {
        activityType: ReservationActivityType;
        userId: string | null;
        metadata: Record<string, unknown>;
        description: string | null;
        createdAt: Date;
      };
      effects: ReservationBillingEffect[];
    };

// No transition enters pending or quote, so they have no default.
const DEFAULT_ACTIVITY_TYPE: Partial<Record<ReservationStatus, ReservationActivityType>> = {
  confirmed: "confirmed",
  ongoing: "picked_up",
  completed: "returned",
  cancelled: "cancelled",
  rejected: "rejected",
  declined: "quote_declined",
};

const FEE_VOIDING_STATUSES: readonly ReservationStatus[] = ["cancelled", "rejected", "declined"];

/**
 * Whether the card gate guards this change (README §8.4): a change into the billable
 * set, unless a completed payment asks for it. The renter already paid then.
 * `confirmed → ongoing → completed` stays inside the set and is never refused.
 */
export function requiresReservationGate(
  from: ReservationStatus,
  to: ReservationStatus,
  actor: ReservationActor,
): boolean {
  return actor !== "payment" && !isBillableReservationStatus(from) && isBillableReservationStatus(to);
}

/** Whether a change into this status voids the reservation's fees: the rental was withdrawn. */
export function isFeeVoidingReservationStatus(status: ReservationStatus): boolean {
  return FEE_VOIDING_STATUSES.includes(status);
}

/**
 * MySQL rounds fractional seconds on a timestamp column. Dropping them first
 * keeps a stored date and its fee's month the same at 23:59:59.6. An activity
 * row written just before a status change uses it too, or MySQL could store it
 * one second after the change. updated_at is not cut: it is the marketplace
 * feed's cursor, and every other writer lets MySQL round it, so a cut value
 * could fall behind a write just before it.
 */
export function toWholeSeconds(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

function stockAction(from: ReservationStatus, to: ReservationStatus): "consume" | "restore" | null {
  if (to === "confirmed" && (from === "pending" || from === "quote")) return "consume";
  if ((to === "cancelled" || to === "rejected") && (from === "confirmed" || from === "ongoing")) {
    return "restore";
  }
  // A completed rental keeps its consumables.
  return null;
}

/** Everything a status change writes and returns, decided from the locked row. */
export function planReservationStatusChange(
  locked: LockedReservation,
  input: PlanReservationStatusChangeInput,
): ReservationStatusChangePlan {
  const from = locked.status;
  const { to, actor } = input;

  if (from === to) return { changed: false, reason: "already_in_target" };
  if (input.expectedFrom !== undefined) {
    const expected: readonly ReservationStatus[] =
      typeof input.expectedFrom === "string" ? [input.expectedFrom] : input.expectedFrom;
    if (!expected.includes(from)) return { changed: false, reason: "unexpected_status" };
  }
  if (!canTransitionReservationStatus(from, to)) return { changed: false, reason: "not_allowed" };

  const activityType = input.activity?.type ?? DEFAULT_ACTIVITY_TYPE[to];
  if (!activityType) throw new Error(`No activity type for a change to ${to}`);

  const now = toWholeSeconds(input.now);
  const entersBillable = !isBillableReservationStatus(from) && isBillableReservationStatus(to);
  const leavesBillable = isBillableReservationStatus(from) && !isBillableReservationStatus(to);

  const effects: ReservationBillingEffect[] = [];
  // The Connect webhook records a paid checkout's fee, with the collected amount.
  if (entersBillable && actor !== "payment") {
    effects.push({
      type: "legacy_fee.record",
      storeId: input.storeId,
      reservationId: input.reservationId,
      marketplace: locked.source === "marketplace",
      at: now,
    });
  }
  // Whatever the previous status was: the cancel paths void unconditionally today.
  if (isFeeVoidingReservationStatus(to)) {
    effects.push({
      type: "legacy_fee.void",
      storeId: input.storeId,
      reservationId: input.reservationId,
    });
  }

  return {
    changed: true,
    stock: stockAction(from, to),
    update: {
      status: to,
      updatedAt: input.now,
      // Set once, on entry. A later step never fills a missing date: the invariant reports it.
      ...(entersBillable && locked.billableAt === null ? { billableAt: now } : {}),
      ...(leavesBillable ? { withdrawnAt: now } : {}),
      ...(to === "ongoing" ? { pickedUpAt: now } : {}),
      ...(to === "completed" ? { returnedAt: now } : {}),
    },
    activity: {
      activityType,
      userId: input.actorUserId,
      metadata: { previousStatus: from, newStatus: to, actor, ...input.activity?.metadata },
      description: input.activity?.description ?? null,
      createdAt: now,
    },
    effects,
  };
}

/**
 * The one way to change a reservation's status. It locks the row, checks the
 * change, moves consumable stock, writes the status and its dates, and logs the
 * activity, all in the caller's transaction. It returns the fee effects; the
 * caller runs them after commit.
 *
 * A change into the billable set throws StoreNotAcceptingReservationsError when the
 * store's card gate is closed (requiresReservationGate), before anything is written.
 */
export async function changeReservationStatus(
  tx: Transaction,
  input: ChangeReservationStatusInput,
): Promise<ChangeReservationStatusResult> {
  const scope = and(
    eq(reservations.id, input.reservationId),
    eq(reservations.storeId, input.storeId),
  );
  const [locked] = await tx
    .select({
      status: reservations.status,
      source: reservations.source,
      billableAt: reservations.billableAt,
    })
    .from(reservations)
    .where(scope)
    .for("update");
  if (!locked) return { changed: false, from: null, reason: "not_found" };

  const now = input.now ?? new Date();
  const plan = planReservationStatusChange(locked, { ...input, now });
  if (!plan.changed) return { changed: false, from: locked.status, reason: plan.reason };
  if (requiresReservationGate(locked.status, input.to, input.actor)) {
    await assertStoreCanTakeReservations(tx, input.storeId, now);
  }

  const change = { from: locked.status, to: input.to };
  await input.beforeWrite?.(tx, change);

  if (plan.stock === "consume") {
    await consumeReservationStock(tx, input.reservationId, input.storeId);
  } else if (plan.stock === "restore") {
    await restoreReservationStock(tx, input.reservationId, input.storeId);
  }

  // drizzle leaves out undefined keys, so absent dates stay as they are.
  await tx
    .update(reservations)
    .set({
      status: plan.update.status,
      updatedAt: plan.update.updatedAt,
      billableAt: plan.update.billableAt,
      withdrawnAt: plan.update.withdrawnAt,
      pickedUpAt: plan.update.pickedUpAt,
      returnedAt: plan.update.returnedAt,
    })
    .where(scope);

  await tx.insert(reservationActivity).values({
    id: nanoid(),
    reservationId: input.reservationId,
    ...plan.activity,
  });
  await markReservation(tx, { id: input.reservationId, storeId: input.storeId });

  return { changed: true, ...change, effects: plan.effects };
}
