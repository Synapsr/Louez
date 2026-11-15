import { db } from "@louez/db";

import { dispatchApiEffects } from "@/lib/api/effects";

import { requeueStaleRefundOperations } from "./stripe-refund";

/**
 * The cron's pass over the refund operations still requested (stripe-refund.ts): one
 * whose outbox row was abandoned or pruned gets a new one, sent at once by the
 * outbox's sender, which settles it with Stripe. Bounded per run and in time.
 */
export async function runStaleRefundOperationsCron(): Promise<{ requeued: number }> {
  const ids = await requeueStaleRefundOperations(db);
  dispatchApiEffects(ids);
  return { requeued: ids.length };
}
