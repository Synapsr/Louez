import type { ApiJobKind } from "@louez/db";

import { jobErrors, type JobView } from "../contracts/jobs";
import { dueJobIds, pruneJobs, readJob, type JobRow } from "../platform/jobs";
import type { LinkStore } from "../platform/links";
import type { ApiDomain } from "../platform/permissions";
import type { ApiPorts } from "../platform/ports";
import { logProviderError } from "../platform/redact";
import { imageJobView, jobProduct, runImageJob, type RunJobOptions } from "./product-images";

/**
 * Background jobs as callers see them (`jobs.get`), and the runner the app
 * and its cron call. Each kind is started by its own domain's procedure;
 * reading one needs read access to that domain.
 */

/** The domain each kind belongs to: who may read it. */
export const JOB_KIND_DOMAINS: Record<ApiJobKind, ApiDomain> = {
  product_image_enhance: "products",
  product_image_remove_background: "products",
};

/** How often `jobs.get` reads the row again while it waits. */
const WAIT_STEP_MS = 2_000;

const ended = (job: JobRow) => job.status === "succeeded" || job.status === "failed";

/**
 * A store's job, as its kind shows it. With `waitSeconds`, reads it again
 * every two seconds until it ends or the time is up.
 */
export async function getJob(
  input: { storeId: string; id: string; waitSeconds?: number },
  context: {
    urls: ApiPorts["urls"];
    store: LinkStore;
    /** Throws when the caller may not read the kind's domain. */
    authorize: (domain: ApiDomain) => void;
    /** Tests replace the wait. */
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<JobView> {
  let job = await readJob(input.storeId, input.id);
  if (!job) throw jobErrors.notFound(input.id);
  context.authorize(JOB_KIND_DOMAINS[job.kind]);

  const sleep = context.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const steps = Math.floor(((input.waitSeconds ?? 0) * 1000) / WAIT_STEP_MS);
  for (let step = 0; step < steps && !ended(job); step += 1) {
    await sleep(WAIT_STEP_MS);
    job = (await readJob(input.storeId, input.id)) ?? job;
  }
  return imageJobView(job, {
    urls: context.urls,
    store: context.store,
    product: await jobProduct(job.storeId, job.targetId),
  });
}

/** Runs one job by its kind. Never throws. */
export async function runJob(id: string, ports: ApiPorts, options: RunJobOptions = {}) {
  try {
    await runImageJob(id, ports, options);
  } catch (error) {
    logProviderError("api_job.run_failed", error);
  }
}

/** The cron's pass: the jobs to run again (handed to the app's runner), then the old ones deleted. */
export async function jobsCronPass() {
  const due = await dueJobIds();
  const pruned = await pruneJobs();
  return { due, pruned };
}
