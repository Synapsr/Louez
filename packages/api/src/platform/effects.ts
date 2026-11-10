import { randomBytes, randomUUID } from "node:crypto";

import { apiEffects, db, reservations, stores, type Transaction } from "@louez/db";
import { and, asc, eq, inArray, like, lt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AgentClient, SetupActor, SetupFacts, StoreSetupSummary } from "./setup-analytics";

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
 * - Leases are granted and compared in the database's time (`NOW(3)`), never
 *   an app server's clock: two servers whose clocks disagree still agree on
 *   who holds a row.
 * - A sender gets an abort signal, passed down to its provider calls, which
 *   fires at its timeout or a margin before its lease ends, whichever comes
 *   first, counted on a monotonic clock from the claim. A sender that times
 *   out keeps the row: its outcome is unknown, so the row (and its key) stays
 *   blocked until the lease ends, and only then runs again. A provider call
 *   that cannot be cancelled can therefore overlap a retry only after the
 *   full lease.
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
/**
 * Who an analytics event is, fixed when its row is added: every retry sends
 * the same id and time, so PostHog counts it once. Optional on the
 * reservation events, whose rows added before it carry neither.
 */
export interface AnalyticsEventIdentity {
  /** A UUID, PostHog's `uuid` of the event. */
  eventUuid: string;
  /** ISO 8601, when the write happened: PostHog's `timestamp` of the event. */
  occurredAt: string;
}

/** A new analytics event's identity (see `AnalyticsEventIdentity`). */
export const analyticsEventIdentity = (occurredAt: Date): AnalyticsEventIdentity => ({
  eventUuid: randomUUID(),
  occurredAt: occurredAt.toISOString(),
});

export interface ApiEffectPayloads {
  /**
   * The customer hears of a status change the store made, on one channel: the
   * answer to their request or quote, or the store's cancellation.
   */
  "reservation.customerMessage": {
    channel: "email" | "sms";
    notification:
      | "customer_request_accepted"
      | "customer_request_rejected"
      | "customer_reservation_cancelled";
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
    /**
     * Who made the change: a status change through the API is always the
     * store's (its dashboard, assistant, API key or agent), which the owner is
     * not emailed about (apps/web lib/notifications/admin-email.ts).
     */
    actor: "customer" | "store" | "system";
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
      /** The reservation's own currency; null for one made before it had one. */
      currency?: string | null;
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
  "reservation.statusAnalytics": Partial<AnalyticsEventIdentity> & {
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
  "reservation.notesAnalytics": Partial<AnalyticsEventIdentity> & {
    ownerUserId: string;
    storeId: string;
    reservationId: string;
    hasNotes: boolean;
    transport: "openapi" | "mcp";
  };
  /**
   * A new store's welcome credits for the AI advisor, as many as the store
   * got when it was created: a later change of the setting changes no grant
   * already queued. No row while the credit layer is off.
   */
  "store.welcomeCredits": { storeId: string; credits: number };
  /** One analytics event of a store's creation: the onboarding's, or the referral program's. */
  "store.creationAnalytics": AnalyticsEventIdentity & {
    event: "store_info_saved" | "referral_attribution_resolved" | "referred_reward_granted";
    ownerUserId: string;
    transport: "rpc" | "openapi" | "mcp";
    /** The event's own facts; the sender adds the referral program's settings. */
    properties: Record<string, string | number | boolean | null>;
  };
  /** The platform's notice that a store went live, on one channel. */
  "store.launchNotification": {
    channel: "discord" | "fromhello";
    store: { id: string; name: string; slug: string };
  };
  /**
   * The analytics event of a store going live: the onboarding's completion,
   * with who set the store up. Rows added before the setup analytics carry
   * no `actor` nor `setup`.
   */
  "store.launchAnalytics": AnalyticsEventIdentity & {
    ownerUserId: string;
    storeId: string;
    reservationMode: "payment" | "request";
    transport: "rpc" | "openapi" | "mcp";
    /** Who put it online (platform/setup-analytics.ts). */
    actor?: SetupActor;
    setup?: StoreSetupSummary;
  };
  /**
   * The e-mail of a team invitation. The token and the address are read
   * from the invitation when it goes out, never kept here: a cancelled or
   * accepted invitation sends nothing, and one sent again links its new token.
   */
  "team.invitationEmail": {
    invitationId: string;
    store: { name: string; logoUrl: string | null; country: string | null };
    inviterName: string;
  };
  /**
   * The analytics event of one setup write an agent made on a store still
   * offline, or of its go-live (platform/setup-analytics.ts): field names and
   * the facts of `SETUP_FACT_KEYS`, never a value a person typed.
   */
  "store.agentSetupAction": AnalyticsEventIdentity & {
    ownerUserId: string;
    storeId: string;
    /** The procedure, as `settings.updateStoreInfo`. */
    procedure: string;
    credentialKind: "api_key" | "oauth";
    /** The agent, as a fixed value; never the client's or the key's own name. */
    agentClient: AgentClient;
    transport: "rpc" | "openapi" | "mcp";
    /** The call was previewed and its confirmation sent back. */
    confirmed: boolean;
    fieldsSet: string[];
    fieldsCleared: string[];
    facts: SetupFacts;
  };
  /**
   * The prepaid credit an SMS used, taken once its provider accepted it
   * (apps/web lib/sms/delivery.ts). Its log row, written at the acceptance,
   * says the credit is owed until this takes it, so taking it again changes
   * nothing. It sends nothing.
   */
  "sms.prepaidDebit": {
    /** The SMS's log row (`sms_logs.id`). */
    recordId: string;
    storeId: string;
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
  /**
   * The row's id, the same on every run of it: what a sender keys the
   * record of what it did on, so a run after a lost outcome sees it.
   */
  effectId: string;
  /** Aborted at the sender's timeout: pass it to every provider call, and send nothing after it. */
  signal: AbortSignal;
  /**
   * Throws once the sender is out of time, even if the signal's timer has
   * not fired yet (a busy event loop delays timers). Call it right before a
   * provider call that cannot be aborted.
   */
  throwIfAborted: () => void;
  /** Throws when this sender no longer holds the row, or is out of time. Call it right before sending. */
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
/** A sender is aborted at least this long before its lease ends. */
export const EFFECT_LEASE_MARGIN_MS = 30_000;
/**
 * When a sender's signal fires. Its provider calls stop then, if they honour
 * the signal; its row stays claimed until the lease ends either way.
 */
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
  /**
   * `performance.now()` just before the database's clock was read for the
   * lease: the sender's time is counted from here, so the rest of the claim
   * (its commit included) is spent from the lease, never added to it.
   */
  grantedAt: number;
};

/** The database's time `ms` from now (negative: ago). App clocks never date a row. */
const dbNowPlus = (ms: number) => sql`TIMESTAMPADD(MICROSECOND, ${Math.round(ms * 1000)}, NOW(3))`;

/**
 * Takes a row for sending, in a short transaction: one that waits, one whose
 * retry is due, or one whose sender's claim expired, under the attempt
 * ceiling, with no earlier row of its key still to do. A row past the
 * ceiling is abandoned; a row whose store or reservation is gone is
 * cancelled. Null when the row is not this sender's to send now.
 *
 * Every decision uses the database's time, read once the row is locked, so
 * neither a wait for the lock nor an app server's clock changes the lease.
 */
export async function claimEffect(
  id: string,
  leaseMs: number = EFFECT_LEASE_MS,
): Promise<Claimed | null> {
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
      })
      .from(apiEffects)
      .where(eq(apiEffects.id, id))
      .for("update");
    if (!row) return null;
    const grantedAt = performance.now();
    // MySQL fixes NOW() when a statement starts: read it in a statement of its
    // own, now that the row is locked. `now` is in the session's time zone, as
    // the TIMESTAMP columns are read and written, so it goes back unchanged.
    const [clock] = await tx
      .select({
        now: sql<string>`DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s.%f')`,
        leaseOver: sql<number | null>`${apiEffects.lockedUntil} < NOW(3)`,
        retryDue: sql<number>`${apiEffects.nextAttemptAt} <= NOW(3)`,
      })
      .from(apiEffects)
      .where(eq(apiEffects.id, id));
    if (!clock) return null;

    const takeover = row.status === "running" && Number(clock.leaseOver) === 1;
    const takeable =
      row.status === "pending" ||
      (row.status === "failed" && Number(clock.retryDue) === 1) ||
      takeover;
    if (!takeable) return null;
    if (row.attempts >= EFFECT_MAX_ATTEMPTS) {
      await tx
        .update(apiEffects)
        // A terminal row is never tried again: its next attempt's date records
        // when it was abandoned, which the inbox shows (services/inbox.ts).
        .set({
          status: "abandoned",
          claimToken: null,
          lockedUntil: null,
          nextAttemptAt: dbNowPlus(0),
        })
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
        lockedUntil: sql`TIMESTAMPADD(MICROSECOND, ${Math.round(leaseMs * 1000)}, ${clock.now})`,
        attempts: row.attempts + 1,
      })
      .where(eq(apiEffects.id, id));
    return {
      id: row.id,
      type: row.type,
      payload: row.payload,
      attempts: row.attempts + 1,
      token,
      grantedAt,
    };
  });
}

/** Whether a claim still holds, in the database's time: its token is the row's, and its lease has not run out. */
async function holdsClaim(id: string, token: string) {
  const [row] = await db
    .select({ id: apiEffects.id })
    .from(apiEffects)
    .where(
      and(
        eq(apiEffects.id, id),
        eq(apiEffects.status, "running"),
        eq(apiEffects.claimToken, token),
        sql`${apiEffects.lockedUntil} > NOW(3)`,
      ),
    );
  return Boolean(row);
}

const fenced = (id: string, token: string) =>
  and(eq(apiEffects.id, id), eq(apiEffects.status, "running"), eq(apiEffects.claimToken, token));

async function recordSent(id: string, token: string) {
  await db
    .update(apiEffects)
    .set({
      status: "sent",
      sentAt: sql`NOW(3)`,
      lockedUntil: null,
      claimToken: null,
      lastError: null,
    })
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

/**
 * A sender that timed out: whether it sent is unknown. The row keeps its
 * lease, so neither it nor a later row of its key runs before the lease
 * ends; the claim is dropped, so the late sender can neither send past its
 * next check nor record.
 */
async function recordUncertain(id: string, token: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(apiEffects)
    .set({ claimToken: null, lastError: `Outcome unknown: ${message}`.slice(0, 1000) })
    .where(fenced(id, token));
}

async function recordFailure(id: string, token: string, attempts: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const abandoned = attempts >= EFFECT_MAX_ATTEMPTS;
  await db
    .update(apiEffects)
    .set({
      status: abandoned ? "abandoned" : "failed",
      lockedUntil: null,
      claimToken: null,
      lastError: message.slice(0, 1000),
      // An abandoned row keeps the time it was abandoned here, as claimEffect does.
      nextAttemptAt: dbNowPlus(abandoned ? 0 : effectRetryDelayMs(attempts)),
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
  /** How long a sender may run; below the lease. */
  sendTimeoutMs?: number;
  /** How long a claim holds its row. Tests shorten it. */
  leaseMs?: number;
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
  const leaseMs = options.leaseMs ?? EFFECT_LEASE_MS;
  const timeoutMs = Math.min(options.sendTimeoutMs ?? EFFECT_SEND_TIMEOUT_MS, leaseMs / 2);
  const outcome = { sent: 0, failed: 0, skipped: 0 };
  for (const id of ids) {
    let claimed: Claimed | null;
    try {
      claimed = await claimEffect(id, leaseMs);
    } catch {
      outcome.skipped += 1;
      continue;
    }
    if (!claimed) {
      outcome.skipped += 1;
      continue;
    }

    const { token } = claimed;
    // The lease starts at the database's clock read inside the claim. Counted
    // on a monotonic clock from just before that read (so a slow commit is
    // spent from it), the abort fires at the timeout or a margin before the
    // lease ends, whichever comes first: a retry can take the row only after
    // the lease, so an aborted sender is enough to fence the last provider call.
    const allowedMs = Math.max(0, Math.min(timeoutMs, leaseMs - EFFECT_LEASE_MARGIN_MS));
    const deadline = claimed.grantedAt + allowedMs;
    const controller = new AbortController();
    const expire = () => {
      if (!controller.signal.aborted) controller.abort(new EffectTimeout(allowedMs));
    };
    const timer = setTimeout(expire, Math.max(0, deadline - performance.now()));
    const timeout = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
        once: true,
      });
    });
    timeout.catch(() => {});
    const throwIfAborted = () => {
      if (performance.now() >= deadline) expire();
      controller.signal.throwIfAborted();
    };
    const context: EffectSendContext = {
      effectId: id,
      signal: controller.signal,
      throwIfAborted,
      assertClaim: async () => {
        throwIfAborted();
        const holds = await holdsClaim(id, token);
        // The claim query itself may have outlasted the sender's time.
        throwIfAborted();
        if (!holds) {
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
        await recordSent(id, token);
        outcome.sent += 1;
      }
    } catch (error) {
      // Out of time, it may have sent part of it, or all: the outcome is unknown.
      const outcomeUnknown = error instanceof EffectTimeout || controller.signal.aborted;
      await (
        outcomeUnknown
          ? recordUncertain(id, token, controller.signal.reason ?? error)
          : recordFailure(id, token, claimed.attempts, error)
      ).catch(() => {});
      outcome.failed += 1;
    } finally {
      clearTimeout(timer);
    }
  }
  return outcome;
}

/**
 * The cron's pass: the rows whose retry is due, those the first dispatch
 * never took, and those whose sender's claim expired, oldest first, in the
 * database's time.
 */
export async function retryDueEffects(
  senders: ApiEffectSenders,
  options: DispatchOptions & { limit?: number } = {},
) {
  const now = sql`NOW(3)`;
  const due = await db
    .select({ id: apiEffects.id })
    .from(apiEffects)
    .where(
      or(
        and(
          eq(apiEffects.status, "pending"),
          lt(apiEffects.createdAt, dbNowPlus(-EFFECT_PENDING_GRACE_MS)),
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
    { sendTimeoutMs: options.sendTimeoutMs, leaseMs: options.leaseMs },
  );
}

/** Deletes the done rows older than the retention: their payloads hold personal data. */
export async function pruneEffects(limit = 500) {
  const old = await db
    .select({ id: apiEffects.id })
    .from(apiEffects)
    .where(
      and(
        inArray(apiEffects.status, [...DONE]),
        lt(apiEffects.createdAt, dbNowPlus(-EFFECT_RETENTION_MS)),
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
