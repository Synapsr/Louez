import { type SQL, and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { enqueueEffects } from "@louez/api/platform/effects";
import {
  type Database,
  type Transaction,
  apiEffects,
  markReservationIds,
  payments,
  reservationActivity,
  reservations,
  stores,
} from "@louez/db";

import { log } from "@/lib/evlog";
import { fromStripeCents } from "@/lib/stripe";

import {
  type DepositIntent,
  type HoldActivity,
  type HoldOutcome,
  type HoldRow,
  type HoldWrites,
  type IntentRefusal,
  absentAttemptTransition,
  bindDepositIntent,
  depositHoldTransition,
  holdRowStateOf,
  intentStateOf,
  reservationRelationOf,
} from "./util.deposit-hold-transition";

// The one writer of a deposit hold. Whoever learns something of a PaymentIntent (the
// store's request, the customer's page, the Connect webhook, the outbox's release)
// hands it here as Stripe has it, with the connected account it was read on.
// `settleDepositIntent` locks the reservation, lets util.deposit-hold-transition.ts
// decide, and writes in one transaction: the hold's row, the reservation's deposit, the
// capture, the activity line and the outbox row of a release that became owed. Nothing
// else writes a `deposit_hold` or `deposit_capture` row, or a reservation's deposit
// status once a hold is asked for; deposit-hold.ts only inserts the attempt it claims,
// and `closeAbsentAttempt` closes one no PaymentIntent was found for. No hold row is
// ever deleted: a closed attempt keeps its row, so its PaymentIntent, should Stripe
// make it after all, is still recorded.

const isHeld = (status: string | null) => status === "authorized" || status === "captured";

/** The amount of a PaymentIntent as `payments.amount` stores it, `decimal(10,2)`. */
const storedAmount = (minor: number, currency: string) =>
  fromStripeCents(minor, currency).toFixed(2);

type LockedDeposit = {
  readonly storeId: string;
  readonly depositStatus: string | null;
  readonly depositPaymentIntentId: string | null;
  /** The store's connected account today. */
  readonly currentAccountId: string | null;
  readonly holds: readonly HoldRow[];
};

/**
 * Locks the reservation, then reads its hold rows and its store's connected account:
 * every writer of a hold row holds that lock, so what is read here is what is decided
 * on.
 */
async function lockDeposit(
  tx: Transaction,
  ref: { readonly reservationId: string; readonly storeId?: string },
): Promise<LockedDeposit | null> {
  const [reservation] = await tx
    .select({
      storeId: reservations.storeId,
      depositStatus: reservations.depositStatus,
      depositPaymentIntentId: reservations.depositPaymentIntentId,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.id, ref.reservationId),
        ref.storeId ? eq(reservations.storeId, ref.storeId) : undefined,
      ),
    )
    .for("update");
  if (!reservation) return null;

  const [store] = await tx
    .select({ accountId: stores.stripeAccountId })
    .from(stores)
    .where(eq(stores.id, reservation.storeId));
  return {
    ...reservation,
    currentAccountId: store?.accountId ?? null,
    holds: await readHoldRows(tx, ref.reservationId),
  };
}

/** The reservation's hold rows, as a decision reads them. */
export async function readHoldRows(
  database: Database | Transaction,
  reservationId: string,
): Promise<HoldRow[]> {
  const rows = await database
    .select({
      id: payments.id,
      status: payments.status,
      paymentIntentId: payments.stripePaymentIntentId,
      accountId: payments.stripeAccountId,
      releaseOwedAt: payments.releaseOwedAt,
      amountMinor: payments.grossMinor,
      currency: payments.currency,
      paymentMethodId: payments.stripePaymentMethodId,
    })
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), eq(payments.type, "deposit_hold")));
  return rows.map(({ releaseOwedAt, ...row }) => ({ ...row, releaseOwed: releaseOwedAt !== null }));
}

/** What a write says of itself on the reservation's activity. */
type SettleContext = {
  /** Who asked: null for the customer, the webhook and the outbox. */
  readonly actorUserId: string | null;
  /** The activity line's text, by kind; the webhook gives none. */
  readonly descriptions?: Partial<Record<HoldActivity, string>>;
  /** Why the store captured, kept on the hold and on its capture. */
  readonly captureReason?: string | null;
  /** Why the provider refused, on the line of a failed attempt. */
  readonly failure?: string;
};

/**
 * One activity line per PaymentIntent and kind, whoever writes it first: an event
 * delivered again, or the webhook after the dashboard, adds none. The store's request
 * completes, with who asked and why, the line the webhook wrote before it.
 */
async function writeHoldActivity(
  tx: Transaction,
  input: {
    readonly reservationId: string;
    readonly type: HoldActivity;
    readonly paymentIntentId: string | null;
    readonly metadata: Record<string, unknown>;
    readonly context: SettleContext;
  },
): Promise<void> {
  const description = input.context.descriptions?.[input.type];
  const [line] = input.paymentIntentId
    ? await tx
        .select({ id: reservationActivity.id })
        .from(reservationActivity)
        .where(
          and(
            eq(reservationActivity.reservationId, input.reservationId),
            eq(reservationActivity.activityType, input.type),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.paymentIntentId')) = ${input.paymentIntentId}`,
            // The webhook's line of a failed payment is one per Stripe event.
            sql`JSON_EXTRACT(${reservationActivity.metadata}, '$.stripeEventId') IS NULL`,
          ),
        )
        .limit(1)
    : [];
  if (!line) {
    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId: input.reservationId,
      userId: input.context.actorUserId,
      activityType: input.type,
      description,
      metadata: input.metadata,
      createdAt: new Date(),
    });
    return;
  }
  // Only the writer that made the change describes it: a release that finds the hold
  // captured leaves the capture's line as its author wrote it.
  if (description === undefined) return;
  await tx
    .update(reservationActivity)
    .set({ userId: input.context.actorUserId, description, metadata: input.metadata })
    .where(eq(reservationActivity.id, line.id));
}

const activityMetadata = (type: HoldActivity, intent: DepositIntent, context: SettleContext) => {
  const amount = fromStripeCents(intent.amountMinor, intent.currency);
  const base = { paymentIntentId: intent.paymentIntentId, amount, currency: intent.currency };
  if (type === "deposit_authorized") {
    return { ...base, expiresAt: intent.captureBefore?.toISOString() ?? null };
  }
  if (type === "deposit_captured") {
    const captured = fromStripeCents(intent.capturedMinor, intent.currency);
    return {
      ...base,
      amount: captured,
      capturedAmount: captured,
      originalAmount: amount,
      reason: context.captureReason ?? null,
    };
  }
  if (type === "deposit_failed") {
    return { ...base, error: context.failure ?? `Stripe: ${intent.status}` };
  }
  return base;
};

/** Writes the hold row of a PaymentIntent, on its row or on a new one; returns its id. */
async function writeHoldRow(
  tx: Transaction,
  input: {
    readonly reservationId: string;
    readonly accountId: string;
    readonly intent: DepositIntent;
    readonly row: HoldRow | null;
    readonly write: Exclude<HoldWrites["row"], null | "close">;
    readonly context: SettleContext;
  },
): Promise<string> {
  const { intent, row, write } = input;
  const now = new Date();
  const amount = storedAmount(intent.amountMinor, intent.currency);
  // What the PaymentIntent holds, written once it holds it: an attempt keeps what it
  // was sent with until then.
  const held =
    write.status === "authorized"
      ? {
          amount,
          stripePaymentMethodId: intent.paymentMethodId,
          authorizationExpiresAt: intent.captureBefore,
          currency: intent.currency,
          // Billing facts (contract Q36): a hold is never insured rental money.
          grossMinor: intent.amountMinor,
          insuranceShareMinor: 0,
          origin: "deposit" as const,
        }
      : {};
  const captured =
    write.status === "completed"
      ? {
          capturedAmount: storedAmount(intent.capturedMinor, intent.currency),
          notes: input.context.captureReason ?? undefined,
          paidAt: now,
        }
      : {};

  if (row) {
    await tx
      .update(payments)
      .set({
        ...held,
        ...captured,
        status: write.status,
        stripePaymentIntentId: intent.paymentIntentId,
        stripeAccountId: input.accountId,
        releaseOwedAt: write.releaseOwed ? sql`COALESCE(${payments.releaseOwedAt}, NOW())` : null,
        // A request that still asks about a pending attempt keeps its claim.
        claimedUntil: write.status === "pending" ? undefined : null,
        // Holds recorded before the billing facts existed get them with their capture.
        ...(write.status === "completed"
          ? {
              grossMinor: sql`COALESCE(${payments.grossMinor}, ${intent.amountMinor})`,
              insuranceShareMinor: sql`COALESCE(${payments.insuranceShareMinor}, 0)`,
              origin: sql`COALESCE(${payments.origin}, 'deposit')`,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(payments.id, row.id));
    return row.id;
  }

  const id = nanoid();
  await tx.insert(payments).values({
    id,
    reservationId: input.reservationId,
    amount,
    type: "deposit_hold",
    method: "stripe",
    stripePaymentIntentId: intent.paymentIntentId,
    stripePaymentMethodId: intent.paymentMethodId,
    stripeAccountId: input.accountId,
    currency: intent.currency,
    grossMinor: intent.amountMinor,
    insuranceShareMinor: 0,
    origin: "deposit",
    ...held,
    ...captured,
    status: write.status,
    releaseOwedAt: write.releaseOwed ? sql`NOW()` : null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** The `deposit_capture` row of a PaymentIntent: written once, whoever records it first. */
async function ensureCaptureRow(
  tx: Transaction,
  input: {
    readonly reservationId: string;
    readonly accountId: string;
    readonly intent: DepositIntent;
    readonly reason: string | null;
  },
): Promise<string | null> {
  const { intent } = input;
  if (!(intent.capturedMinor > 0)) return null;
  const now = new Date();
  const [recorded] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, input.reservationId),
        eq(payments.type, "deposit_capture"),
        eq(payments.stripePaymentIntentId, intent.paymentIntentId),
      ),
    )
    .limit(1);
  if (recorded) {
    if (input.reason !== null) {
      await tx
        .update(payments)
        .set({ notes: input.reason, updatedAt: now })
        .where(eq(payments.id, recorded.id));
    }
    return recorded.id;
  }
  const id = nanoid();
  await tx.insert(payments).values({
    id,
    reservationId: input.reservationId,
    amount: storedAmount(intent.capturedMinor, intent.currency),
    type: "deposit_capture",
    method: "stripe",
    status: "completed",
    stripePaymentIntentId: intent.paymentIntentId,
    // The service matches Stripe's application fees on it.
    stripeChargeId: intent.chargeId,
    stripeAccountId: input.accountId,
    currency: intent.currency,
    grossMinor: intent.capturedMinor,
    insuranceShareMinor: 0,
    origin: "deposit",
    notes: input.reason,
    paidAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function writeReservationDeposit(
  tx: Transaction,
  reservationId: string,
  status: Exclude<HoldWrites["reservation"], null>,
  intent: DepositIntent | null,
): Promise<void> {
  // The reservation references the PaymentIntent it holds, or that was captured.
  const referenced = status === "authorized" || status === "captured" ? intent : null;
  const held = status === "authorized" ? intent : null;
  // Drizzle leaves a column alone for undefined.
  await tx
    .update(reservations)
    .set({
      depositStatus: status,
      depositPaymentIntentId: referenced?.paymentIntentId,
      // Null when the provider states no deadline: an older hold's date is not this one's.
      depositAuthorizationExpiresAt: held ? held.captureBefore : undefined,
      // The card that carries the hold.
      stripePaymentMethodId: held?.paymentMethodId ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId));
}

export type SettledDepositIntent =
  | { readonly status: "reservation_not_found" }
  /** The PaymentIntent is not written on this reservation: nothing was. */
  | { readonly status: "refused"; readonly reason: IntentRefusal }
  | {
      readonly status: "settled";
      readonly outcome: HoldOutcome;
      /** The `deposit_capture` row of the PaymentIntent, when it was captured. */
      readonly capturePaymentId: string | null;
      /** The outbox rows added for a release that became owed: hand them to the dispatcher. */
      readonly effectIds: readonly string[];
    };

/**
 * Writes what Stripe says of one PaymentIntent, read on `accountId`: its hold row, the
 * reservation's deposit while it may reference it, its capture, its activity line and,
 * when the reservation holds another, the outbox row that asks for its release. All
 * in one transaction, under the reservation's row lock, so the same PaymentIntent in
 * the same state is written once whoever comes first, and a snapshot older than what
 * was written changes nothing.
 */
export async function settleDepositIntent(
  database: Database,
  input: {
    readonly reservationId: string;
    /** Checked when given. The webhook checks the connected account instead. */
    readonly storeId?: string;
    readonly accountId: string;
    /** As Stripe has it now. */
    readonly intent: DepositIntent;
  } & SettleContext,
): Promise<SettledDepositIntent> {
  const { intent, accountId, reservationId } = input;
  return database.transaction(async (tx) => {
    const deposit = await lockDeposit(tx, input);
    if (!deposit) return { status: "reservation_not_found" };

    const binding = bindDepositIntent({
      reservationId,
      holds: deposit.holds,
      intent,
      accountId,
      currentAccount: deposit.currentAccountId === accountId,
    });
    if (!binding.ok) return { status: "refused", reason: binding.reason };

    const rowState = holdRowStateOf(binding.row);
    const writes = depositHoldTransition(
      rowState,
      intentStateOf(intent.status),
      reservationRelationOf(deposit, intent.paymentIntentId),
    );
    if (writes.outcome === "stale") {
      log.info(
        "deposit-hold",
        `${intent.paymentIntentId} read ${intent.status} on reservation ${reservationId}, whose row is ${rowState}: nothing written`,
      );
    }

    const rowId =
      writes.row && writes.row !== "close"
        ? await writeHoldRow(tx, {
            reservationId,
            accountId,
            intent,
            row: binding.row,
            write: writes.row,
            context: input,
          })
        : (binding.row?.id ?? null);
    if (writes.reservation) {
      await writeReservationDeposit(tx, reservationId, writes.reservation, intent);
    }
    const capturePaymentId = writes.capture
      ? await ensureCaptureRow(tx, {
          reservationId,
          accountId,
          intent,
          reason: input.captureReason ?? null,
        })
      : null;
    if (writes.activity) {
      await writeHoldActivity(tx, {
        reservationId,
        type: writes.activity,
        paymentIntentId: intent.paymentIntentId,
        metadata: activityMetadata(writes.activity, intent, input),
        context: input,
      });
    }
    // The debt and the work that pays it are one write: a crash after it leaves the
    // outbox row, which the cron runs.
    const effectIds =
      writes.owesRelease && rowId
        ? await enqueueEffects(tx, deposit.storeId, [
            {
              type: "deposit.holdRelease",
              payload: {
                reservationId,
                paymentId: rowId,
                accountId,
                paymentIntentId: intent.paymentIntentId,
              },
            },
          ])
        : [];
    if (writes.row || writes.reservation || writes.capture) {
      await markReservationIds(tx, [reservationId]);
    }
    return { status: "settled", outcome: writes.outcome, capturePaymentId, effectIds };
  });
}

/** Why an attempt is closed with no PaymentIntent found. */
export type AttemptClosure =
  /** Stripe refused the request, saying why. */
  | { readonly kind: "refused"; readonly message: string }
  /** A complete listing, past the life of the key, holds none. */
  | { readonly kind: "not_found" }
  /** The store checked its Stripe dashboard and declared it found none. */
  | { readonly kind: "declared_by_store" };

/**
 * Closes a store's attempt no PaymentIntent was found for: its row is kept and set
 * `failed`, so no request asks about it again and the next attempt has a new key,
 * while a PaymentIntent Stripe makes of it after all still finds its row
 * (`bindDepositIntent`). A refusal fails the deposit; the store's declaration is
 * recorded with who made it. Only while the row is still that attempt, pending and
 * without a PaymentIntent: one the webhook settled meanwhile is left as it is, and
 * `false` is answered.
 */
export async function closeAbsentAttempt(
  database: Database,
  input: {
    readonly reservationId: string;
    readonly storeId: string;
    readonly attemptId: string;
    readonly closure: AttemptClosure;
    readonly actorUserId: string | null;
  },
): Promise<boolean> {
  const { closure } = input;
  return database.transaction(async (tx) => {
    const deposit = await lockDeposit(tx, input);
    const row = deposit?.holds.find((hold) => hold.id === input.attemptId);
    if (!deposit || !row || row.status !== "pending" || row.paymentIntentId !== null) {
      return false;
    }
    const writes = absentAttemptTransition({
      refused: closure.kind === "refused",
      reservationHolds: isHeld(deposit.depositStatus),
    });
    await tx
      .update(payments)
      .set({ status: "failed", claimedUntil: null, updatedAt: sql`NOW()` })
      .where(
        and(
          eq(payments.id, input.attemptId),
          eq(payments.reservationId, input.reservationId),
          eq(payments.type, "deposit_hold"),
          eq(payments.status, "pending"),
          isNull(payments.stripePaymentIntentId),
        ),
      );
    if (writes.reservation) {
      await writeReservationDeposit(tx, input.reservationId, writes.reservation, null);
    }
    const context = { actorUserId: input.actorUserId };
    if (writes.activity && closure.kind === "refused") {
      const reason = `Échec de l'empreinte: ${closure.message}`;
      await writeHoldActivity(tx, {
        reservationId: input.reservationId,
        type: writes.activity,
        paymentIntentId: null,
        metadata: { paymentIntentId: null, attemptId: input.attemptId, error: reason },
        context: { ...context, descriptions: { deposit_failed: reason } },
      });
    }
    if (closure.kind === "declared_by_store") {
      // Who closed it, and when: the line's author and date.
      const description =
        "Empreinte non confirmée close: la boutique n'a trouvé aucune autorisation chez Stripe";
      await writeHoldActivity(tx, {
        reservationId: input.reservationId,
        type: "deposit_failed",
        paymentIntentId: null,
        metadata: {
          paymentIntentId: null,
          attemptId: input.attemptId,
          closedBy: "store",
          amount:
            row.amountMinor !== null && row.currency
              ? fromStripeCents(row.amountMinor, row.currency)
              : null,
          currency: row.currency,
        },
        context: { ...context, descriptions: { deposit_failed: description } },
      });
    }
    await markReservationIds(tx, [input.reservationId]);
    return true;
  });
}

/** How long after an outbox row was added for a debt before the cron adds another. */
const RELEASE_REQUEUE_HOURS = 24;

/**
 * An outbox row that is still to run for a hold's release, or one added less than a
 * day ago, whatever became of it: a debt that has neither gets a new row.
 */
const releaseInFlight = (paymentId: SQL | string) =>
  sql`EXISTS (
    SELECT 1 FROM ${apiEffects}
    WHERE ${apiEffects.type} = 'deposit.holdRelease'
      AND JSON_UNQUOTE(JSON_EXTRACT(${apiEffects.payload}, '$.paymentId')) = ${paymentId}
      AND (
        ${apiEffects.status} IN ('pending', 'running', 'failed')
        OR ${apiEffects.createdAt} > NOW() - INTERVAL ${sql.raw(String(RELEASE_REQUEUE_HOURS))} HOUR
      )
  )`;

/**
 * The debt, not its outbox row, says what Louez owes: every hold row whose release is
 * owed (`release_owed_at`) has a `deposit.holdRelease` row still to run. One the outbox
 * abandoned (Stripe down for hours, or an instance still running code that had no
 * sender for it) or deleted with its retention gets a new one, a day at most after
 * the last was added, on the database's clock. Bounded per run; the oldest debts
 * first. The new rows' ids, for the dispatcher.
 */
export async function requeueOwedReleases(database: Database, limit = 50): Promise<string[]> {
  const owed = await database
    .select({ id: payments.id, reservationId: payments.reservationId })
    .from(payments)
    .where(
      and(
        eq(payments.type, "deposit_hold"),
        isNotNull(payments.releaseOwedAt),
        sql`NOT ${releaseInFlight(sql`${payments.id}`)}`,
      ),
    )
    .orderBy(asc(payments.releaseOwedAt), asc(payments.id))
    .limit(limit);

  const enqueued: string[] = [];
  for (const debt of owed) {
    const ids = await database.transaction(async (tx) => {
      // Under the lock every writer of a hold row takes, the debt is read again: one
      // Stripe settled meanwhile, or a row another run added, adds nothing.
      const [reservation] = await tx
        .select({ storeId: reservations.storeId })
        .from(reservations)
        .where(eq(reservations.id, debt.reservationId))
        .for("update");
      if (!reservation) return [];
      const [row] = await tx
        .select({
          paymentIntentId: payments.stripePaymentIntentId,
          accountId: payments.stripeAccountId,
          inFlight: sql<number>`${releaseInFlight(debt.id)}`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.id, debt.id),
            eq(payments.type, "deposit_hold"),
            isNotNull(payments.releaseOwedAt),
          ),
        );
      if (!row?.paymentIntentId || !row.accountId || Number(row.inFlight) === 1) return [];
      return enqueueEffects(tx, reservation.storeId, [
        {
          type: "deposit.holdRelease",
          payload: {
            reservationId: debt.reservationId,
            paymentId: debt.id,
            accountId: row.accountId,
            paymentIntentId: row.paymentIntentId,
          },
        },
      ]);
    });
    enqueued.push(...ids);
  }
  return enqueued;
}
