import type { ApiEffectPayloads } from "@louez/api/platform/effects";
import { enqueueEffects } from "@louez/api/platform/effects";
import { db, isDuplicateKeyError, smsCredits, smsLogs } from "@louez/db";
import { and, eq, gt, sql } from "drizzle-orm";

/**
 * The record of an SMS the provider accepted: its log row (what the monthly
 * quota counts) and, for one paid from the prepaid balance, its credit. Both
 * are written in one transaction, once per record id, so writing it again
 * after a lost answer or from the outbox changes nothing.
 */
export type SmsDeliveryRecord = ApiEffectPayloads["sms.deliveryRecord"];

/** Writes the record once: the log row, and the prepaid credit it used. Throws when the database does. */
export async function recordSmsDelivery(record: SmsDeliveryRecord): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      if (record.creditSource === "topup") {
        // One debit at a time per store, and the record's check below sees the one before.
        await tx
          .select({ id: smsCredits.id })
          .from(smsCredits)
          .where(eq(smsCredits.storeId, record.storeId))
          .for("update");
      }
      const [written] = await tx
        .select({ id: smsLogs.id })
        .from(smsLogs)
        .where(eq(smsLogs.id, record.id))
        .limit(1);
      if (written) return;

      await tx.insert(smsLogs).values({
        id: record.id,
        storeId: record.storeId,
        reservationId: record.reservationId,
        customerId: record.customerId,
        to: record.to,
        message: record.message,
        templateType: record.templateType,
        status: "sent",
        messageId: record.messageId,
        creditSource: record.creditSource,
        sentAt: new Date(record.sentAt),
      });
      if (record.creditSource === "topup") {
        await tx
          .update(smsCredits)
          .set({
            balance: sql`${smsCredits.balance} - 1`,
            totalUsed: sql`${smsCredits.totalUsed} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(smsCredits.storeId, record.storeId), gt(smsCredits.balance, 0)));
      }
    });
  } catch (error) {
    // Written meanwhile by another try of the same record (a plan SMS takes no lock).
    if (isDuplicateKeyError(error)) return;
    throw error;
  }
}

/** Hands the record to the outbox, which writes it later, retrying until it is written. */
export async function queueSmsDeliveryRecord(record: SmsDeliveryRecord): Promise<void> {
  await db.transaction((tx) =>
    enqueueEffects(tx, record.storeId, [
      {
        type: "sms.deliveryRecord",
        orderingKey: `sms:${record.id}`,
        reservationId: record.reservationId ?? undefined,
        customerId: record.customerId ?? undefined,
        payload: record,
      },
    ]),
  );
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
