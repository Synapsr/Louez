import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * Background jobs: work a call starts and that runs past it (an AI photo
 * enhancement takes minutes). The call answers at once with the job;
 * `jobs.get` reads it until it is done (platform/jobs.ts).
 */

export const JOB_KINDS = ["product_image_enhance", "product_image_remove_background"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/**
 * `queued`: waiting for a runner, or for its retry after a failure that may
 * pass. `running`: being processed. `succeeded`, `failed`: the end.
 */
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Longest wait `jobs.get` takes, in seconds: well within any client's timeout for a tool call. */
export const JOB_WAIT_SECONDS_MAX = 25;

const versionRefSchema = z.object({
  url: z.string(),
  /** Its id among the photo's versions (`imageVersions` of products_get). */
  versionId: z.string(),
});

export const jobSchema = z.object({
  id: z.string(),
  kind: z.enum(JOB_KINDS),
  status: z.enum(JOB_STATUSES),
  /** One sentence for the user, about where the job stands. */
  summary: z.string(),
  createdAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  /** Runs so far, retries included. */
  attempts: z.number().int(),
  /** How long such a job usually takes, from its start. */
  estimatedSeconds: z.object({ min: z.number().int(), max: z.number().int() }),
  /** When to read it again. */
  pollAfterSeconds: z.number().int(),
  /** The product the job works on. */
  productId: z.string(),
  /** What the job costs once it succeeds, in AI credits; 0 when free. Nothing is charged before. */
  priceCredits: z.number(),
  /** The photo before: the version the job started from. */
  source: versionRefSchema,
  /**
   * The photo after, once succeeded: it replaced the source on the product,
   * and the source stays among the photo's versions. Null before.
   */
  result: versionRefSchema
    .extend({
      /** What was charged, in AI credits. */
      creditsCharged: z.number(),
    })
    .nullable(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).nullable(),
  /** The product's dashboard page and, while it is active, its storefront page. */
  links: resourceLinksSchema,
});
export type JobView = z.infer<typeof jobSchema>;

export const getJobInput = z.object({
  id: z.string().min(1).max(21),
  waitSeconds: z.coerce
    .number()
    .int()
    .min(0)
    .max(JOB_WAIT_SECONDS_MAX)
    .optional()
    .describe(
      `Wait up to this many seconds (at most ${JOB_WAIT_SECONDS_MAX}) for the job to end before answering. Default 0: answer at once.`,
    ),
});
export type GetJobInput = z.infer<typeof getJobInput>;
export const getJobOutput = jobSchema;

export const jobErrors = {
  notFound: (id: string) =>
    apiError("NOT_FOUND", "JOB_NOT_FOUND", {
      message: `No job ${id} in this store.`,
      details: { id },
    }),
};
