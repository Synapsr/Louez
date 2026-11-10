import { enqueueEffects } from "@louez/api/platform/effects";
import { db, isDuplicateKeyError, smsCredits, smsLogs } from "@louez/db";
import { and, eq, gt, sql } from "drizzle-orm";

/**
 * The records of an SMS, in two steps (lib/sms/delivery.ts):
 *
 * 1. Its acceptance, right after the provider accepted it: its log row (what
 *    the monthly quota counts), under an id that stays the same across the
 *    retries of what sent it, and, for one paid from the prepaid balance, the
 *    outbox row that takes its credit. One short transaction, no lock wait.
 * 2. Its credit, taken by that outbox row once: the log row says
 *    `topup_pending` until the credit is taken, `topup` after.
 */

/** The credit source of a log row whose prepaid credit is not taken yet. */
const TOPUP_PENDING = "topup_pending";

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

/**
 * Whether the provider already accepted the SMS of this id. A locking read:
 * an acceptance still being written is waited for, not missed.
 */
export async function isSmsAccepted(id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: smsLogs.id })
      .from(smsLogs)
      .where(eq(smsLogs.id, id))
      .for("share");
    return Boolean(row);
  });
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
        creditSource: prepaid ? TOPUP_PENDING : "plan",
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
 * the log row says whether it was taken. Never below zero. Throws when the
 * database does, for the outbox to try again.
 */
export async function takePrepaidSmsCredit(recordId: string, storeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // One debit at a time per store, in the order the credits' lock gives.
    await tx
      .select({ id: smsCredits.id })
      .from(smsCredits)
      .where(eq(smsCredits.storeId, storeId))
      .for("update");
    const [owed] = await tx
      .select({ id: smsLogs.id })
      .from(smsLogs)
      .where(
        and(
          eq(smsLogs.id, recordId),
          eq(smsLogs.storeId, storeId),
          eq(smsLogs.creditSource, TOPUP_PENDING),
        ),
      )
      .for("update");
    if (!owed) return;

    await tx
      .update(smsCredits)
      .set({
        balance: sql`${smsCredits.balance} - 1`,
        totalUsed: sql`${smsCredits.totalUsed} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(smsCredits.storeId, storeId), gt(smsCredits.balance, 0)));
    await tx.update(smsLogs).set({ creditSource: "topup" }).where(eq(smsLogs.id, recordId));
  });
}

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
