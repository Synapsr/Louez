import { after } from "next/server";

import { jobsCronPass, runJob } from "@louez/api/services/jobs";

import { apiPorts } from "@/lib/api/ports";
import { log } from "@/lib/evlog";

/**
 * Jobs this process runs at once (an AI photo holds rembg and GPT Image for
 * minutes). A job past it stays queued, and the cron takes it.
 */
const MAX_RUNNING = 2;
let running = 0;

function runInBackground(ids: readonly string[]) {
  const run = async () => {
    for (const id of ids) {
      if (running >= MAX_RUNNING) {
        log.info({ apiJobs: { event: "left_for_cron", id } });
        continue;
      }
      running += 1;
      // One at a time within a call; calls run side by side, up to the limit.
      await runJob(id, apiPorts).finally(() => {
        running -= 1;
      });
    }
  };
  const guarded = () =>
    run().catch((error: unknown) =>
      log.error({ apiJobs: { event: "dispatch_failed", ids, error: String(error) } }),
    );
  try {
    after(guarded);
  } catch {
    // Outside a request (a script): run it now, without waiting.
    void guarded();
  }
}

/**
 * `ApiPorts.dispatchJobs`: runs the jobs a committed write queued, once the
 * answer is sent. Never throws.
 */
export function dispatchApiJobs(ids: readonly string[]): void {
  if (ids.length === 0) return;
  runInBackground(ids);
}

/**
 * The cron's pass over the jobs: those the first dispatch left (queued past
 * their grace or their retry's wait, running past their lease) run in the
 * background, never in the cron's own request; then the jobs ended 90 days
 * ago are deleted.
 */
export async function runApiJobsCron() {
  const { due, pruned } = await jobsCronPass();
  runInBackground(due);
  return { started: due.length, pruned };
}
