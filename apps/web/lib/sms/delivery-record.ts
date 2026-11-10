import { enqueueEffects } from "@louez/api/platform/effects";
import { db, isDuplicateKeyError, smsCredits, smsLogs, type Transaction } from "@louez/db";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import { SMS_CREDIT_SOURCE } from "./credit-source";

/**
 * The records of an SMS, in two steps (lib/sms/delivery.ts):
 *
 * 1. Its acceptance, right after the provider accepted it: its log row (what
 *    the monthly quota counts), under an id that stays the same across the
 *    retries of what sent it, and, for one paid from the prepaid balance, the
 *    outbox row that takes its credit. One short transaction, no lock wait.
 * 2. Its credit, taken by that outbox row once: the log row says
 *    `topup_pending` until the credit is taken, `topup` after, or
 *    `topup_unpaid` when the balance was empty; the next top-up takes it
 *    (`collectUnpaidSmsCredits`). The quota check counts the owed ones as
 *    spent (lib/plan-limits.ts).
 */

export interface SmsAcceptance {
  /** The log row's id: the outbox row's that sent it, or a new one. */
  id: string;
  storeId: string;
  reservationId: string | null;
  customerId: string | null;
  to: string;
  message: string;
  templateType: string;
  /** The provider's id of the message. */
  messageId: string | null;
  creditSource: "plan" | "topup";
}

/** Tries of the acceptance check while a write of that id holds its row, and the wait between. */
const ACCEPTANCE_CHECK_TRIES = 5;
const ACCEPTANCE_CHECK_WAIT_MS = 200;

/**
 * Whether the provider already accepted the SMS of this id. A locking read
 * that never queues behind a lock: an acceptance still being written is
 * looked at again a few times (a second at most, well within the outbox's
 * time), then the check throws and its run is retried later, without
 * calling the provider.
 */
export async function isSmsAccepted(id: string): Promise<boolean> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: smsLogs.id })
          .from(smsLogs)
          .where(eq(smsLogs.id, id))
          .for("share", { noWait: true });
        return Boolean(row);
      });
    } catch (error) {
      if (!isLockNowaitError(error) || attempt >= ACCEPTANCE_CHECK_TRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, ACCEPTANCE_CHECK_WAIT_MS));
    }
  }
}

/** MySQL's refusal of a NOWAIT read on a locked row (ER_LOCK_NOWAIT, errno 3572), cause chain included. */
function isLockNowaitError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ("code" in current && current.code === "ER_LOCK_NOWAIT") return true;
    if ("errno" in current && current.errno === 3572) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

/**
 * Writes the acceptance once: the log row, and the outbox row that takes a
 * prepaid credit. Returns the outbox rows to dispatch (none when it was
 * already written).
 */
export async function recordSmsAcceptance(acceptance: SmsAcceptance): Promise<string[]> {
  try {
    return await db.transaction(async (tx) => {
      const prepaid = acceptance.creditSource === "topup";
      await tx.insert(smsLogs).values({
        id: acceptance.id,
        storeId: acceptance.storeId,
        reservationId: acceptance.reservationId,
        customerId: acceptance.customerId,
        to: acceptance.to,
        message: acceptance.message,
        templateType: acceptance.templateType,
        status: "sent",
        messageId: acceptance.messageId,
        creditSource: prepaid ? SMS_CREDIT_SOURCE.topupPending : SMS_CREDIT_SOURCE.plan,
      });
      if (!prepaid) return [];
      return enqueueEffects(tx, acceptance.storeId, [
        {
          type: "sms.prepaidDebit",
          // No reservation on the row: its deletion must not cancel a credit the SMS used.
          orderingKey: `sms:${acceptance.id}`,
          payload: { recordId: acceptance.id, storeId: acceptance.storeId },
        },
      ]);
    });
  } catch (error) {
    // Written by an earlier run of the same SMS: its credit is queued already.
    if (isDuplicateKeyError(error)) return [];
    throw error;
  }
}

/**
 * Takes the prepaid credit an SMS owes, once: under the store's credits lock,
 * the log row says whether it was taken. An empty balance leaves the debt
 * owed (`topup_unpaid`), for the next top-up. Throws when the database does,
 * for the outbox to try again.
 */
export async function takePrepaidSmsCredit(recordId: string, storeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // One debit at a time per store, in the order the credits' lock gives.
    await lockSmsCredits(tx, storeId);
    const [owed] = await tx
      .select({ id: smsLogs.id })
      .from(smsLogs)
      .where(
        and(
          eq(smsLogs.id, recordId),
          eq(smsLogs.storeId, storeId),
          eq(smsLogs.creditSource, SMS_CREDIT_SOURCE.topupPending),
        ),
      )
      .for("update");
    if (!owed) return;

    const [{ affectedRows }] = await tx
      .update(smsCredits)
      .set({
        balance: sql`${smsCredits.balance} - 1`,
        totalUsed: sql`${smsCredits.totalUsed} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(smsCredits.storeId, storeId), gt(smsCredits.balance, 0)));
    await tx
      .update(smsLogs)
      .set({
        creditSource: affectedRows === 1 ? SMS_CREDIT_SOURCE.topup : SMS_CREDIT_SOURCE.topupUnpaid,
      })
      .where(eq(smsLogs.id, recordId));
  });
}

/**
 * Takes, from a balance just topped up, the credits SMS still owe because the
 * balance was empty when they went out: the oldest first, as many as it
 * holds. Runs in the top-up's transaction, after its credits are added.
 */
export async function collectUnpaidSmsCredits(tx: Transaction, storeId: string): Promise<number> {
  const [credits] = await lockSmsCredits(tx, storeId);
  if (!credits || credits.balance <= 0) return 0;
  const unpaid = await tx
    .select({ id: smsLogs.id })
    .from(smsLogs)
    .where(
      and(eq(smsLogs.storeId, storeId), eq(smsLogs.creditSource, SMS_CREDIT_SOURCE.topupUnpaid)),
    )
    .orderBy(asc(smsLogs.sentAt), asc(smsLogs.id))
    .limit(credits.balance)
    .for("update");
  if (unpaid.length === 0) return 0;

  await tx
    .update(smsCredits)
    .set({
      balance: sql`${smsCredits.balance} - ${unpaid.length}`,
      totalUsed: sql`${smsCredits.totalUsed} + ${unpaid.length}`,
      updatedAt: new Date(),
    })
    .where(eq(smsCredits.storeId, storeId));
  for (const row of unpaid) {
    await tx
      .update(smsLogs)
      .set({ creditSource: SMS_CREDIT_SOURCE.topup })
      .where(eq(smsLogs.id, row.id));
  }
  return unpaid.length;
}

/** The store's credits row, locked: every write of the balance takes it first. */
const lockSmsCredits = (tx: Transaction, storeId: string) =>
  tx
    .select({ id: smsCredits.id, balance: smsCredits.balance })
    .from(smsCredits)
    .where(eq(smsCredits.storeId, storeId))
    .for("update");

/** Logs an SMS that did not go out. Never throws: a log must not turn a refusal into a retry storm. */
export async function recordSmsFailure(failure: {
  storeId: string;
  reservationId?: string;
  customerId?: string;
  to: string;
  message: string;
  templateType: string;
  messageId?: string;
  error?: string;
  creditSource: "plan" | "topup";
}): Promise<void> {
  try {
    await db.insert(smsLogs).values({
      storeId: failure.storeId,
      reservationId: failure.reservationId ?? null,
      customerId: failure.customerId ?? null,
      to: failure.to,
      message: failure.message,
      templateType: failure.templateType,
      status: "failed",
      messageId: failure.messageId ?? null,
      error: failure.error ?? null,
      creditSource: failure.creditSource,
    });
  } catch (error) {
    console.error("Failed to log SMS:", error);
  }
}
