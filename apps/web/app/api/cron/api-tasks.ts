import { purgeOAuthTokens } from "@louez/auth/oauth-retention";
import { purgeOperations } from "@louez/api/platform/operations";
import { purgeHandoffs } from "@louez/api/services/handoffs";
import { pruneInboxAcknowledgements } from "@louez/api/services/inbox";
import { purgeStagedUploads } from "@louez/api/services/uploads";

import { runApiEffectsCron } from "@/lib/api/effects";
import { runApiJobsCron } from "@/lib/api/jobs";
import { log } from "@/lib/evlog";
import { runPartnerStatementsCron } from "@/lib/partners/partner-statements-cron";
import { settleAbandonedCheckouts } from "@/lib/reservations/abandoned-checkouts";
import { runDepositReleaseDebtsCron } from "@/lib/reservations/deposit-hold-debts";
import { runStaleRefundOperationsCron } from "@/lib/reservations/stripe-refund-cron";
import { apiStorage } from "@/lib/storage/api-storage";

import type { IsolatedTask } from "./isolated-tasks";

/**
 * The agent-ready API's tasks, on every cron call: the releases of deposit holds
 * Louez owes and whose outbox row is gone or abandoned get a new one
 * (lib/reservations/deposit-hold-debts.ts), and so do the refunds of online payments
 * still requested (lib/reservations/stripe-refund-cron.ts), the partners' monthly
 * statements are queued once their month has ended (lib/partners), then the outbox, then the
 * purges past their retention, each on its own and each bounded per run (the
 * inbox's acknowledgements, the handoffs, the writes' records after 12 months,
 * the OAuth tokens 7 days after they lapse, and once an hour, at :40, the image
 * uploads left in staging a day after they were sent: listing the bucket every
 * minute is not worth it), then the background jobs (those
 * the first dispatch left run in the background, never in the cron's request;
 * jobs ended 90 days ago are deleted), then the online checkouts no event will
 * settle, at most 20 a run and 20 seconds (lib/reservations/abandoned-checkouts.ts).
 */
export function apiTasks(now: Date): IsolatedTask[] {
  return [
    {
      task: "deposit-release-debts",
      key: "depositReleaseDebts",
      run: () => runDepositReleaseDebtsCron(),
    },
    {
      task: "stale-refund-operations",
      key: "staleRefundOperations",
      run: () => runStaleRefundOperationsCron(),
    },
    // Before the outbox: a partner's statement queued now goes out in this run.
    {
      task: "partner-statements",
      key: "partnerStatements",
      run: () => runPartnerStatementsCron(),
    },
    { task: "api-effects", key: "apiEffects", run: () => runApiEffectsCron() },
    {
      task: "inbox-acknowledgements",
      key: "inboxAcknowledgements",
      run: () => pruneInboxAcknowledgements(),
    },
    { task: "api-handoffs", key: "apiHandoffs", run: () => purgeHandoffs() },
    { task: "api-operations", key: "apiOperations", run: () => purgeOperations() },
    { task: "oauth-tokens", key: "oauthTokens", run: () => purgeOAuthTokens() },
    ...(now.getUTCMinutes() === 40
      ? [
          {
            task: "upload-staging",
            key: "uploadStaging",
            run: () =>
              purgeStagedUploads(apiStorage, { now, log: { error: (event) => log.error(event) } }),
          },
        ]
      : []),
    { task: "api-jobs", key: "apiJobs", run: () => runApiJobsCron() },
    // Last: it waits on Stripe, within a time budget and a short timeout per read,
    // and the tasks run in turn, so it holds none of the others back.
    {
      task: "abandoned-checkouts",
      key: "abandonedCheckouts",
      run: () => settleAbandonedCheckouts(),
    },
  ];
}
