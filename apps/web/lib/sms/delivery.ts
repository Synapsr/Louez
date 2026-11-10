import { nanoid } from "nanoid";

import { log } from "@/lib/evlog";

import { sendSms } from "./client";
import {
  queueSmsDeliveryRecord,
  recordSmsDelivery,
  recordSmsFailure,
  type SmsDeliveryRecord,
} from "./delivery-record";

/**
 * Sends one SMS, once, and records it. The provider's acceptance is the
 * delivery: from then on nothing turns it into a failure, so a caller (an
 * outbox row) never sends it again. Its record, the log row the monthly quota
 * counts and the prepaid credit it used, is written once, keyed by an id
 * chosen before the first try: a few tries right away, then the outbox
 * (`sms.deliveryRecord`) until it is written.
 */

export interface SmsDeliveryInput {
  storeId: string;
  reservationId?: string;
  customerId?: string;
  /** The normalized phone number. */
  to: string;
  message: string;
  templateType: string;
  creditSource: "plan" | "topup";
  sender?: string;
}

export type SmsDeliveryResult =
  | { success: true; messageId?: string }
  | { success: false; error: string };

/** Tries of the record right after the send, and the waits between them. */
const RECORD_RETRY_DELAYS_MS = [100, 400];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function deliverSms(input: SmsDeliveryInput): Promise<SmsDeliveryResult> {
  const failure = {
    storeId: input.storeId,
    reservationId: input.reservationId,
    customerId: input.customerId,
    to: input.to,
    message: input.message,
    templateType: input.templateType,
    creditSource: input.creditSource,
  };

  let accepted: { messageId?: string };
  try {
    const result = await sendSms({
      to: input.to,
      message: input.message,
      ...(input.sender ? { sender: input.sender } : {}),
    });
    if (!result.success) {
      const error = result.error || "The SMS was not sent.";
      await recordSmsFailure({ ...failure, messageId: result.messageId, error });
      return { success: false, error };
    }
    accepted = { messageId: result.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await recordSmsFailure({ ...failure, error: message });
    return { success: false, error: message };
  }

  await settleSmsDelivery({
    id: nanoid(),
    storeId: input.storeId,
    reservationId: input.reservationId ?? null,
    customerId: input.customerId ?? null,
    to: input.to,
    message: input.message,
    templateType: input.templateType,
    messageId: accepted.messageId ?? null,
    creditSource: input.creditSource,
    sentAt: new Date().toISOString(),
  });
  return { success: true, ...(accepted.messageId ? { messageId: accepted.messageId } : {}) };
}

/** Writes the record of a delivered SMS, or hands it to the outbox. Never throws. */
async function settleSmsDelivery(record: SmsDeliveryRecord): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RECORD_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await wait(RECORD_RETRY_DELAYS_MS[attempt - 1] ?? 0);
    try {
      await recordSmsDelivery(record);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  try {
    await queueSmsDeliveryRecord(record);
    log.warn({
      sms: {
        event: "delivery_record_queued",
        recordId: record.id,
        storeId: record.storeId,
        error: String(lastError),
      },
    });
  } catch (error) {
    // Nothing durable is reachable: the SMS went out, its log row and credit are lost.
    log.error({
      sms: {
        event: "delivery_record_lost",
        recordId: record.id,
        storeId: record.storeId,
        messageId: record.messageId,
        creditSource: record.creditSource,
        error: String(error),
      },
    });
  }
}
