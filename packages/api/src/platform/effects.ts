import { randomBytes } from "node:crypto";

import { apiEffects, db, reservations, stores, type Transaction } from "@louez/db";
import { and, asc, eq, inArray, like, lt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * The outbox of the agent-ready API: the effects of a committed write that
 * must not be lost (a customer's email, a store notification, an analytics
 * event). A service adds them in its transaction (`enqueueEffects`), one row
 * per effect and channel, with everything they need, so a rollback leaves
 * none and a later edit changes none. Once committed it hands their ids to
 * `ports.dispatchEffects`; the app sends them with its senders
 * (`dispatchEffects`), and its cron retries the failed ones and prunes the
 * old ones (`retryDueEffects`, `pruneEffects`).
 *
 * - A sender claims its row first, in a short transaction, with a fresh token.
 *   Only the holder of the current token records the outcome: a sender whose
 *   claim expired and was taken over changes nothing, and checks its claim
 *   (`assertClaim`) right before it sends.
 * - Rows of one ordering key (one channel of one reservation's messages) run
 *   one at a time, in the order they were added: a row waits while an earlier
 *   one of its key is not done.
 * - A row whose store or reservation is gone is cancelled, never sent.
 * - A sender runs within a timeout below the claim's lease.
 *
 * An effect is sent at least once: a sender that dies between sending and
 * recording leaves its claim to expire, and the row runs again.
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
  /** The customer hears of the answer to their request or quote, on one channel. */
  "reservation.customerMessage": {
    channel: "email" | "sms";
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
  /**
   * The store's own notification on one channel. Where it goes (the owner's
   * phone, the webhook, the members' devices) and whether the store still
   * wants it are read when it goes out.
   */
  "reservation.storeNotification": {
    channel: "sms" | "push" | "discord";
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
  /** The platform's notification of a status change, on one channel. */
  "reservation.platformNotification": {
    channel: "discord" | "fromhello";
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

/** One effect to add: its type and payload, and where it belongs. */
export type ApiEffect = {
  [K in ApiEffectType]: {
    type: K;
    payload: ApiEffectPayloads[K];
    /** Rows of one key run one at a time, in the order they were added. */
    orderingKey?: string;
    reservationId?: string;
    customerId?: string;
  };
}[ApiEffectType];

/** What a sender gets besides the payload. */
export interface EffectSendContext {
  /** Aborted when the sender ran out of time: it must not send after it. */
  signal: AbortSignal;
  /** Throws when this sender no longer holds the row. Call it right before sending. */
  assertClaim: () => Promise<void>;
}

/**
 * The app's sender of each effect type. A sender throws when the effect
 * failed and may succeed later; it returns `{ skipped }` when there is
 * nothing to send (its channel turned off, no address, a limit reached).
 */
export type ApiEffectSenders = {
  [K in ApiEffectType]: (
    payload: ApiEffectPayloads[K],
    context: EffectSendContext,
  ) => Promise<void | { skipped: string }>;
};

/** How long a sender holds a row before another may take it over. */
export const EFFECT_LEASE_MS = 5 * 60_000;
/** How long a sender may run: well within its lease. */
export const EFFECT_SEND_TIMEOUT_MS = 2 * 60_000;
/** Runs of one row before it is abandoned. */
export const EFFECT_MAX_ATTEMPTS = 8;
/** A pending row the first dispatch has not taken after this long is the cron's. */
export const EFFECT_PENDING_GRACE_MS = 60_000;
/** How long a done row (sent, abandoned, cancelled, superseded) is kept. */
export const EFFECT_RETENTION_MS = 30 * 86_400_000;

const UNFINISHED = ["pending", "running", "failed"] as const;
const DONE = ["sent", "abandoned", "cancelled", "superseded"] as const;

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
    orderingKey: effect.orderingKey ?? null,
    reservationId: effect.reservationId ?? null,
    customerId: effect.customerId ?? null,
  }));
  // One by one, so `seq` follows the order of the list.
  for (const row of rows) await tx.insert(apiEffects).values(row);
  return rows.map((row) => row.id);
}

/**
 * Marks the unsent rows whose ordering key starts with `keyPrefix`, and
 * whose payload's `match.field` is one of `match.values`, as superseded, in
 * the write's transaction: newer news replaces them. A row a sender holds is
 * left to finish; the new rows wait for it.
 */
export async function supersedeEffects(
  tx: Transaction,
  storeId: string,
  keyPrefix: string,
  match: { field: string; values: readonly string[] },
) {
  if (match.values.length === 0) return;
  await tx
    .update(apiEffects)
    .set({ status: "superseded", payload: {}, claimToken: null })
    .where(
      and(
        eq(apiEffects.storeId, storeId),
        like(apiEffects.orderingKey, `${keyPrefix.replace(/[\\%_]/g, "\\$&")}%`),
        inArray(apiEffects.status, ["pending", "failed"]),
        inArray(sql`JSON_UNQUOTE(JSON_EXTRACT(${apiEffects.payload}, ${`$.${match.field}`}))`, [
          ...match.values,
        ]),
      ),
    );
}

/** Changes a field of a row's payload that is still waiting, e.g. a count known after the commit. */
export async function amendEffectPayload(id: string, field: string, value: number) {
  const [row] = await db
    .select({ payload: apiEffects.payload })
    .from(apiEffects)
    .where(and(eq(apiEffects.id, id), eq(apiEffects.status, "pending")));
  if (!row) return;
  await db
    .update(apiEffects)
    .set({ payload: { ...row.payload, [field]: value } })
    .where(and(eq(apiEffects.id, id), eq(apiEffects.status, "pending")));
}

type Claimed = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  token: string;
};

/**
 * Takes a row for sending, in a short transaction: one that waits, one whose
 * retry is due, or one whose sender's claim expired, under the attempt
 * ceiling, with no earlier row of its key still to do. A row past the
 * ceiling is abandoned; a row whose store or reservation is gone is
 * cancelled. Null when the row is not this sender's to send now.
 */
export async function claimEffect(id: string, now = new Date()): Promise<Claimed | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: apiEffects.id,
        seq: apiEffects.seq,
        storeId: apiEffects.storeId,
        reservationId: apiEffects.reservationId,
        orderingKey: apiEffects.orderingKey,
        type: apiEffects.type,
        payload: apiEffects.payload,
        status: apiEffects.status,
        attempts: apiEffects.attempts,
        nextAttemptAt: apiEffects.nextAttemptAt,
        lockedUntil: apiEffects.lockedUntil,
      })
      .from(apiEffects)
      .where(eq(apiEffects.id, id))
      .for("update");
    if (!row) return null;

    const takeover = row.status === "running" && row.lockedUntil !== null && row.lockedUntil < now;
    const takeable =
      row.status === "pending" || (row.status === "failed" && row.nextAttemptAt <= now) || takeover;
    if (!takeable) return null;
    if (row.attempts >= EFFECT_MAX_ATTEMPTS) {
      await tx
        .update(apiEffects)
        .set({ status: "abandoned", claimToken: null, lockedUntil: null })
        .where(eq(apiEffects.id, id));
      return null;
    }

    if (row.orderingKey) {
      const [earlier] = await tx
        .select({ id: apiEffects.id })
        .from(apiEffects)
        .where(
          and(
            eq(apiEffects.orderingKey, row.orderingKey),
            lt(apiEffects.seq, row.seq),
            inArray(apiEffects.status, [...UNFINISHED]),
          ),
        )
        .limit(1);
      if (earlier) return null;
    }

    const [store] = await tx
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.id, row.storeId));
    const [reservation] = row.reservationId
      ? await tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(eq(reservations.id, row.reservationId))
      : [{ id: null }];
    if (!store || !reservation) {
      // Nothing to tell anyone any more, and nothing personal to keep.
      await tx
        .update(apiEffects)
        .set({
          status: "cancelled",
          payload: {},
          claimToken: null,
          lockedUntil: null,
          lastError: store ? "The reservation is gone." : "The store is gone.",
        })
        .where(eq(apiEffects.id, id));
      return null;
    }

    const token = randomBytes(16).toString("hex");
    await tx
      .update(apiEffects)
      .set({
        status: "running",
        claimToken: token,
        lockedUntil: new Date(now.getTime() + EFFECT_LEASE_MS),
        attempts: row.attempts + 1,
      })
      .where(eq(apiEffects.id, id));
    return {
      id: row.id,
      type: row.type,
      payload: row.payload,
      attempts: row.attempts + 1,
      token,
    };
  });
}

/** Whether a claim still holds: its token is the row's, and its lease has not run out. */
async function holdsClaim(id: string, token: string, now: Date) {
  const [row] = await db
    .select({ claimToken: apiEffects.claimToken, lockedUntil: apiEffects.lockedUntil })
    .from(apiEffects)
    .where(and(eq(apiEffects.id, id), eq(apiEffects.status, "running")));
  return Boolean(row && row.claimToken === token && row.lockedUntil && row.lockedUntil > now);
}

const fenced = (id: string, token: string) =>
  and(eq(apiEffects.id, id), eq(apiEffects.status, "running"), eq(apiEffects.claimToken, token));

async function recordSent(id: string, token: string, now: Date) {
  await db
    .update(apiEffects)
    .set({ status: "sent", sentAt: now, lockedUntil: null, claimToken: null, lastError: null })
    .where(fenced(id, token));
}

async function recordSkipped(id: string, token: string, reason: string) {
  await db
    .update(apiEffects)
    .set({
      status: "cancelled",
      payload: {},
      lockedUntil: null,
      claimToken: null,
      lastError: `Skipped: ${reason}`.slice(0, 1000),
    })
    .where(fenced(id, token));
}

async function recordFailure(
  id: string,
  token: string,
  attempts: number,
  error: unknown,
  now: Date,
) {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(apiEffects)
    .set({
      status: attempts >= EFFECT_MAX_ATTEMPTS ? "abandoned" : "failed",
      lockedUntil: null,
      claimToken: null,
      lastError: message.slice(0, 1000),
      nextAttemptAt: new Date(now.getTime() + effectRetryDelayMs(attempts)),
    })
    .where(fenced(id, token));
}

const isEffectType = (type: string, senders: ApiEffectSenders): type is ApiEffectType =>
  Object.prototype.hasOwnProperty.call(senders, type);

class EffectTimeout extends Error {
  constructor(ms: number) {
    super(`The sender did not finish within ${ms} ms.`);
    this.name = "EffectTimeout";
  }
}

export interface DispatchOptions {
  /** The clock, read at each claim and each outcome. Tests pass their own. */
  now?: () => Date;
  /** How long a sender may run; below the lease. */
  sendTimeoutMs?: number;
}

/**
 * Sends the rows, one after the other: claim, send within the timeout,
 * record the outcome under the claim. A row another sender holds, or that
 * waits for an earlier row of its key, is skipped. Never throws: a failure
 * is recorded on its row, and the cron retries it.
 */
export async function dispatchEffects(
  ids: readonly string[],
  senders: ApiEffectSenders,
  options: DispatchOptions = {},
): Promise<{ sent: number; failed: number; skipped: number }> {
  const now = options.now ?? (() => new Date());
  const timeoutMs = Math.min(options.sendTimeoutMs ?? EFFECT_SEND_TIMEOUT_MS, EFFECT_LEASE_MS / 2);
  const outcome = { sent: 0, failed: 0, skipped: 0 };
  for (const id of ids) {
    let claimed: Claimed | null;
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

    const { token } = claimed;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new EffectTimeout(timeoutMs));
      }, timeoutMs);
    });
    const context: EffectSendContext = {
      signal: controller.signal,
      assertClaim: async () => {
        controller.signal.throwIfAborted();
        if (!(await holdsClaim(id, token, now()))) {
          throw new Error("This sender no longer holds the effect: another one took it over.");
        }
      },
    };
    try {
      const { type } = claimed;
      if (!isEffectType(type, senders)) throw new Error(`No sender for the effect ${type}.`);
      const send = senders[type] as (
        payload: unknown,
        context: EffectSendContext,
      ) => Promise<void | { skipped: string }>;
      const result = await Promise.race([send(claimed.payload, context), timeout]);
      if (result && "skipped" in result) {
        await recordSkipped(id, token, result.skipped);
        outcome.skipped += 1;
      } else {
        await recordSent(id, token, now());
        outcome.sent += 1;
      }
    } catch (error) {
      await recordFailure(id, token, claimed.attempts, error, now()).catch(() => {});
      outcome.failed += 1;
    } finally {
      clearTimeout(timer);
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
  options: DispatchOptions & { limit?: number } = {},
) {
  const clock = options.now ?? (() => new Date());
  const now = clock();
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
    .orderBy(asc(apiEffects.seq))
    .limit(options.limit ?? 50);
  return dispatchEffects(
    due.map((row) => row.id),
    senders,
    { now: clock, sendTimeoutMs: options.sendTimeoutMs },
  );
}

/** Deletes the done rows older than the retention: their payloads hold personal data. */
export async function pruneEffects(now = new Date(), limit = 500) {
  const old = await db
    .select({ id: apiEffects.id })
    .from(apiEffects)
    .where(
      and(
        inArray(apiEffects.status, [...DONE]),
        lt(apiEffects.createdAt, new Date(now.getTime() - EFFECT_RETENTION_MS)),
      ),
    )
    .limit(limit);
  if (old.length === 0) return 0;
  await db.delete(apiEffects).where(
    inArray(
      apiEffects.id,
      old.map((row) => row.id),
    ),
  );
  return old.length;
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
      claimToken: apiEffects.claimToken,
    })
    .from(apiEffects)
    .where(inArray(apiEffects.id, [...ids]));
}
