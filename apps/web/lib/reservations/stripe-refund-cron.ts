import { rearmAbandonedEffects } from "@louez/api/platform/effects";
import { db } from "@louez/db";

import { dispatchApiEffects } from "@/lib/api/effects";

import { requeueStaleRefundOperations } from "./stripe-refund";

/**
 * The cron's pass over what refunds still owe. A refund operation still open
 * (stripe-refund.ts) whose outbox row was abandoned or pruned gets a new one, sent at
 * once by the outbox's sender, which settles it with Stripe; bounded per run and in
 * time. A refund's credit note the outbox gave up on a day ago or more, a manual
 * refund's or an online one's, is armed again (`rearmAbandonedEffects`), at most once a
 * day per row and 20 a run.
 */
export async function runStaleRefundOperationsCron(): Promise<{
  requeued: number;
  creditNotesRearmed: number;
}> {
  const ids = await requeueStaleRefundOperations(db);
  const rearmed = await rearmAbandonedEffects();
  dispatchApiEffects([...ids, ...rearmed]);
  return { requeued: ids.length, creditNotesRearmed: rearmed.length };
}
