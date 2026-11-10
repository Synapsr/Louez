import { nanoid } from "nanoid";

import { log } from "@/lib/evlog";

import { sendSms } from "./client";
import { isSmsAccepted, recordSmsAcceptance, recordSmsFailure } from "./delivery-record";
import { fitSmsSegments } from "./encoding";

/**
 * Sends one SMS at most once per key, and records it. The provider's
 * acceptance is the delivery: from then on nothing turns it into a failure.
 *
 * - An SMS an outbox row sends is keyed by the row's id, the same on every
 *   run of it. A run that finds that key accepted already answers that it
 *   went out, and never calls the provider again: a run that timed out after
 *   the provider accepted, then retried, sends nothing twice.
 * - Right after the acceptance, one short write records it: the log row,
 *   under that key, and for a prepaid SMS the outbox row that takes its
 *   credit (`sms.prepaidDebit`). The sender returns then; the credit is taken
 *   apart, once, however long the credits' lock makes it wait.
 * - The text is held to three segments (lib/sms/encoding.ts).
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
  /**
   * The id that keeps it to one SMS across retries: the outbox row's. Without
   * one (a send no outbox retries), a new id.
   */
  deliveryKey?: string;
}

export type SmsDeliveryResult =
  | { success: true; messageId?: string }
  | { success: false; error: string };

/** Tries of the acceptance's write, which takes no lock and is quick. */
const ACCEPTANCE_TRIES = 2;

export async function deliverSms(input: SmsDeliveryInput): Promise<SmsDeliveryResult> {
  const message = fitSmsSegments(input.message);
  if (input.deliveryKey && (await isSmsAccepted(input.deliveryKey))) {
    return { success: true };
  }

  const failure = {
    storeId: input.storeId,
    reservationId: input.reservationId,
    customerId: input.customerId,
    to: input.to,
    message,
    templateType: input.templateType,
    creditSource: input.creditSource,
  };
  let messageId: string | undefined;
  try {
    const result = await sendSms({
      to: input.to,
      message,
      ...(input.sender ? { sender: input.sender } : {}),
    });
    if (!result.success) {
      const error = result.error || "The SMS was not sent.";
      await recordSmsFailure({ ...failure, messageId: result.messageId, error });
      return { success: false, error };
    }
    messageId = result.messageId;
  } catch (error) {
    const text = error instanceof Error ? error.message : "Unknown error";
    await recordSmsFailure({ ...failure, error: text });
    return { success: false, error: text };
  }

  await recordAcceptance({
    id: input.deliveryKey ?? nanoid(),
    storeId: input.storeId,
    reservationId: input.reservationId ?? null,
    customerId: input.customerId ?? null,
    to: input.to,
    message,
    templateType: input.templateType,
    messageId: messageId ?? null,
    creditSource: input.creditSource,
  });
  return { success: true, ...(messageId ? { messageId } : {}) };
}

/** Writes the acceptance and starts taking its credit. Never throws. */
async function recordAcceptance(acceptance: Parameters<typeof recordSmsAcceptance>[0]) {
  for (let attempt = 1; attempt <= ACCEPTANCE_TRIES; attempt += 1) {
    try {
      const debits = await recordSmsAcceptance(acceptance);
      if (debits.length > 0) await dispatchDebits(debits);
      return;
    } catch (error) {
      if (attempt < ACCEPTANCE_TRIES) continue;
      // The SMS went out: it is not sent again. Its log row and credit are lost.
      log.error({
        sms: {
          event: "acceptance_not_recorded",
          recordId: acceptance.id,
          storeId: acceptance.storeId,
          messageId: acceptance.messageId,
          creditSource: acceptance.creditSource,
          error: String(error),
        },
      });
    }
  }
}

/**
 * Hands the credit's outbox rows to the app's dispatch, which runs them after
 * the answer, apart from this sender; a row it misses is the cron's. Loaded
 * when needed: the outbox's senders import this module.
 */
async function dispatchDebits(ids: string[]) {
  try {
    const { dispatchApiEffects } = await import("@/lib/api/effects");
    dispatchApiEffects(ids);
  } catch (error) {
    log.warn({ sms: { event: "debit_dispatch_failed", ids, error: String(error) } });
  }
}
