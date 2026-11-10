import { purgeOAuthTokens } from "@louez/auth/oauth-retention";
import { purgeOperations } from "@louez/api/platform/operations";
import { purgeHandoffs } from "@louez/api/services/handoffs";
import { pruneInboxAcknowledgements } from "@louez/api/services/inbox";
import { purgeStagedUploads } from "@louez/api/services/uploads";

import { runApiEffectsCron } from "@/lib/api/effects";
import { runApiJobsCron } from "@/lib/api/jobs";
import { apiStorage } from "@/lib/storage/api-storage";

import type { IsolatedTask } from "./isolated-tasks";

/**
 * The agent-ready API's tasks, on every cron call: the outbox first, then the
 * purges past their retention, each on its own and each bounded per run (the
 * inbox's acknowledgements, the handoffs, the writes' records after 12 months,
 * the OAuth tokens 7 days after they lapse, the image uploads left in staging
 * a day after they were sent), then the background jobs (those
 * the first dispatch left run in the background, never in the cron's request;
 * jobs ended 90 days ago are deleted).
 */
export function apiTasks(): IsolatedTask[] {
  return [
    { task: "api-effects", key: "apiEffects", run: () => runApiEffectsCron() },
    {
      task: "inbox-acknowledgements",
      key: "inboxAcknowledgements",
      run: () => pruneInboxAcknowledgements(),
    },
    { task: "api-handoffs", key: "apiHandoffs", run: () => purgeHandoffs() },
    { task: "api-operations", key: "apiOperations", run: () => purgeOperations() },
    { task: "oauth-tokens", key: "oauthTokens", run: () => purgeOAuthTokens() },
    { task: "upload-staging", key: "uploadStaging", run: () => purgeStagedUploads(apiStorage) },
    { task: "api-jobs", key: "apiJobs", run: () => runApiJobsCron() },
  ];
}
