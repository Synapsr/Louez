import { apiEffects, db, stores, type Transaction } from "@louez/db";
import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * The outbox of the agent-ready API: the effects of a committed write that
 * must not be lost (a customer's email, a store notification, an analytics
 * event). A service adds them in its transaction (`enqueueEffects`), with
 * everything they need, so a rollback leaves none and a later edit changes
 * none. Once committed it hands their ids to `ports.dispatchEffects`; the app
 * sends them with its senders (`dispatchEffects`), and its cron retries the
 * failed ones (`retryDueEffects`).
 *
 * Each row runs once at a time: a sender claims it atomically first, so two
 * dispatchers never both send it. A sender that dies mid-send leaves its claim
 * to expire, and the row runs again: an effect is sent at least once, and
 * once in every other case.
 */

type StoreRow = typeof stores.$inferSelect;

/** The store as a customer message shows it, frozen at the write. */
export interface EffectStore {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  darkLogoUrl: string | null;
  theme: StoreRow["theme"];
  settings: StoreRow["settings"];
  emailSettings: StoreRow["emailSettings"];
  customerNotificationSettings: StoreRow["customerNotificationSettings"];
  /** The store has terms of sale: the email links to them. */
  hasTerms: boolean;
}

/** A reservation's status, as effects carry it. */
type Status =
  | "pending"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled"
  | "rejected"
  | "quote"
  | "declined";

/** Every effect, by type, with its payload. Dates are ISO 8601 strings: payloads are JSON. */
export interface ApiEffectPayloads {
  /** The customer hears of the answer to their request or quote. */
  "reservation.customerMessage": {
    notification: "customer_request_accepted" | "customer_request_rejected";
    store: EffectStore;
    customer: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
    };
    reservation: {
      id: string;
      number: string;
      startDate: string;
      endDate: string;
      totalAmount: string;
      subtotalAmount: string;
      depositAmount: string;
      taxRate: string | null;
      subtotalExclTax: string | null;
      taxAmount: string | null;
      /** The language the reservation was made in. */
      locale: string | null;
    };
    items: Array<{ name: string; quantity: number; unitPrice: string; totalPrice: string }>;
    rejectionReason: string | null;
  };
  /** The store's own notification (SMS, email, Discord), as its preferences say at sending. */
  "reservation.storeNotification": {
    event:
      | "reservation_confirmed"
      | "reservation_rejected"
      | "reservation_picked_up"
      | "reservation_completed"
      | "reservation_cancelled";
    storeId: string;
    reservation: {
      id: string;
      number: string;
      startDate: string;
      endDate: string;
      totalAmount: string;
    };
    customer: { firstName: string; lastName: string; email: string; phone: string | null };
  };
  /** The platform's notification of a status change. */
  "reservation.platformNotification": {
    kind: "confirmed" | "rejected" | "picked_up" | "completed" | "cancelled";
    store: { id: string; name: string; slug: string };
    number: string;
    totalAmount: string;
    currency: string | null;
  };
  /** The product analytics event of a status change. */
  "reservation.statusAnalytics": {
    ownerUserId: string;
    storeId: string;
    reservationId: string;
    from: Status;
    to: Status;
    transport: "rpc" | "openapi" | "mcp";
    /** Warnings the answer carried; the insurance step may add one after the commit. */
    warningCount: number;
  };
  /** The product analytics event of a notes change by the API or an agent. */
  "reservation.notesAnalytics": {
    ownerUserId: string;
    storeId: string;
    reservationId: string;
    hasNotes: boolean;
    transport: "openapi" | "mcp";
  };
}

export type ApiEffectType = keyof ApiEffectPayloads;

export type ApiEffect = {
  [K in ApiEffectType]: { type: K; payload: ApiEffectPayloads[K] };
}[ApiEffectType];

/** The app's sender of each effect type. A sender throws when the effect failed. */
export type ApiEffectSenders = {
  [K in ApiEffectType]: (payload: ApiEffectPayloads[K]) => Promise<void>;
};

/** How long a sender holds a row before another may take it over. */
export const EFFECT_LEASE_MS = 5 * 60_000;
/** Runs of one row before it is abandoned. */
export const EFFECT_MAX_ATTEMPTS = 8;
/** A pending row the first dispatch has not taken after this long is the cron's. */
export const EFFECT_PENDING_GRACE_MS = 60_000;

/** The wait before the next run of a failed row: 1, 2, 4… minutes, at most 6 hours. */
export function effectRetryDelayMs(attempts: number) {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000);
}

/** Adds effects in the write's transaction; returns their ids, for `ports.dispatchEffects`. */
export async function enqueueEffects(
  tx: Transaction,
  storeId: string,
  effects: readonly ApiEffect[],
): Promise<string[]> {
  if (effects.length === 0) return [];
  const rows = effects.map((effect) => ({
    id: nanoid(),
    storeId,
    type: effect.type,
    payload: { ...effect.payload },
  }));
  await tx.insert(apiEffects).values(rows);
  return rows.map((row) => row.id);
}

/** Changes a field of a row's payload that is still waiting, e.g. a count known after the commit. */
export async function amendEffectPayload(id: string, field: string, value: number) {
  await db
    .update(apiEffects)
    .set({ payload: sql`JSON_SET(${apiEffects.payload}, ${`$.${field}`}, ${value})` })
    .where(and(eq(apiEffects.id, id), eq(apiEffects.status, "pending")));
}

/**
 * Takes a row for sending, atomically: one that waits, one whose retry is
 * due, or one whose sender's claim expired. Null when another sender has it,
 * or it is sent or abandoned.
 */
export async function claimEffect(id: string, now = new Date()) {
  const [result] = await db
    .update(apiEffects)
    .set({
      status: "running",
      lockedUntil: new Date(now.getTime() + EFFECT_LEASE_MS),
      attempts: sql`${apiEffects.attempts} + 1`,
    })
    .where(
      and(
        eq(apiEffects.id, id),
        or(
          eq(apiEffects.status, "pending"),
          and(eq(apiEffects.status, "failed"), lte(apiEffects.nextAttemptAt, now)),
          and(eq(apiEffects.status, "running"), lt(apiEffects.lockedUntil, now)),
        ),
      ),
    );
  if (result.affectedRows !== 1) return null;
  const [row] = await db
    .select({
      id: apiEffects.id,
      type: apiEffects.type,
      payload: apiEffects.payload,
      attempts: apiEffects.attempts,
    })
    .from(apiEffects)
    .where(eq(apiEffects.id, id));
  return row ?? null;
}

async function recordSent(id: string, now: Date) {
  await db
    .update(apiEffects)
    .set({ status: "sent", sentAt: now, lockedUntil: null, lastError: null })
    .where(and(eq(apiEffects.id, id), eq(apiEffects.status, "running")));
}

async function recordFailure(id: string, attempts: number, error: unknown, now: Date) {
  const message = error instanceof Error ? error.message : String(error);
  const abandoned = attempts >= EFFECT_MAX_ATTEMPTS;
  await db
    .update(apiEffects)
    .set({
      status: abandoned ? "abandoned" : "failed",
      lockedUntil: null,
      lastError: message.slice(0, 1000),
      nextAttemptAt: new Date(now.getTime() + effectRetryDelayMs(attempts)),
    })
    .where(and(eq(apiEffects.id, id), eq(apiEffects.status, "running")));
}

const isEffectType = (type: string, senders: ApiEffectSenders): type is ApiEffectType =>
  Object.prototype.hasOwnProperty.call(senders, type);

/**
 * Sends the rows, one after the other: claim, send, record the outcome. A
 * row another sender holds is skipped. Never throws: a failure is recorded
 * on its row, and the cron retries it.
 */
export async function dispatchEffects(
  ids: readonly string[],
  senders: ApiEffectSenders,
  now: () => Date = () => new Date(),
): Promise<{ sent: number; failed: number; skipped: number }> {
  const outcome = { sent: 0, failed: 0, skipped: 0 };
  for (const id of ids) {
    let claimed: Awaited<ReturnType<typeof claimEffect>>;
    try {
      claimed = await claimEffect(id, now());
    } catch {
      outcome.skipped += 1;
      continue;
    }
    if (!claimed) {
      outcome.skipped += 1;
      continue;
    }
    try {
      const { type } = claimed;
      if (!isEffectType(type, senders)) throw new Error(`No sender for the effect ${type}.`);
      const send = senders[type] as (payload: unknown) => Promise<void>;
      await send(claimed.payload);
      await recordSent(id, now());
      outcome.sent += 1;
    } catch (error) {
      await recordFailure(id, claimed.attempts, error, now()).catch(() => {});
      outcome.failed += 1;
    }
  }
  return outcome;
}

/**
 * The cron's pass: the rows whose retry is due, those the first dispatch
 * never took, and those whose sender's claim expired, oldest first.
 */
export async function retryDueEffects(
  senders: ApiEffectSenders,
  options: { now?: Date; limit?: number } = {},
) {
  const now = options.now ?? new Date();
  const due = await db
    .select({ id: apiEffects.id })
    .from(apiEffects)
    .where(
      or(
        and(
          eq(apiEffects.status, "pending"),
          lt(apiEffects.createdAt, new Date(now.getTime() - EFFECT_PENDING_GRACE_MS)),
        ),
        and(eq(apiEffects.status, "failed"), lte(apiEffects.nextAttemptAt, now)),
        and(eq(apiEffects.status, "running"), lt(apiEffects.lockedUntil, now)),
      ),
    )
    .orderBy(asc(apiEffects.createdAt), asc(apiEffects.id))
    .limit(options.limit ?? 50);
  return dispatchEffects(
    due.map((row) => row.id),
    senders,
    () => now,
  );
}

/** The rows of some ids, for tests and checks. */
export function readEffects(ids: readonly string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: apiEffects.id,
      type: apiEffects.type,
      status: apiEffects.status,
      attempts: apiEffects.attempts,
      payload: apiEffects.payload,
      lastError: apiEffects.lastError,
    })
    .from(apiEffects)
    .where(inArray(apiEffects.id, [...ids]));
}
