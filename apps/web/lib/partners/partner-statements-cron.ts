import { queueMonthlyPartnerStatements } from "@louez/api/services/partner-space";

import { dispatchApiEffects } from "@/lib/api/effects";

/**
 * The cron's pass over Liens partenaires: once a month has ended, each partner
 * who wants it gets its statement by e-mail, once (packages/api
 * services/partner-space.ts). Its rows go out now; a failed one is the
 * outbox's to retry.
 */
export async function runPartnerStatementsCron(now: Date = new Date()) {
  const effectIds = await queueMonthlyPartnerStatements(now);
  dispatchApiEffects(effectIds);
  return { queued: effectIds.length };
}
