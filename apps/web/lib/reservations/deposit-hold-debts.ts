import { db } from "@louez/db";

import { dispatchApiEffects } from "@/lib/api/effects";

import { requeueOwedReleases } from "./deposit-hold-writes";

/**
 * The cron's pass over the releases Louez owes (deposit-hold-writes.ts): a debt whose
 * outbox row was abandoned or deleted gets a new one, sent at once. Every cron call;
 * with it, no instance has to be upgraded before another for a release to go out.
 */
export async function runDepositReleaseDebtsCron(): Promise<{ requeued: number }> {
  const ids = await requeueOwedReleases(db);
  dispatchApiEffects(ids);
  return { requeued: ids.length };
}
