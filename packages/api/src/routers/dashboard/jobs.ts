import { getJobInput, getJobOutput, JOB_WAIT_SECONDS_MAX } from "../../contracts/jobs";
import { platformErrors } from "../../platform/errors";
import { storeProcedure } from "../../platform/procedures";
import { getJob } from "../../services/jobs";
import { mayRead } from "./product-context";

/**
 * Background jobs, on every transport: `jobs_get` on MCP, `/api/v1/jobs/{id}`
 * on OpenAPI. Each kind is started by its own domain's procedure (an AI
 * photo operation: `products_enhance_image`, `products_remove_image_background`);
 * the logic is in services/jobs.ts and platform/jobs.ts.
 */

const get = storeProcedure
  .meta({
    capability: "jobs.get",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "jobs_get",
      title: "Get Job Status",
      description: `Where a background job stands, such as an AI photo enhancement or background removal: queued, running, succeeded (with its result) or failed (with why; nothing was charged). Takes the job's id, as the tool that started it returned it, and an optional waitSeconds (at most ${JOB_WAIT_SECONDS_MAX}) to wait for the job to end before answering; pollAfterSeconds says when to read it again. For a photo job, source is the photo before; result, once succeeded, is the photo after, which replaced it on the product, with creditsCharged, and source.versionId is the original's version id, which products_use_image_version takes to put it back. Its \`links\` are the product's pages. It only reads. Needs read access to the job's domain: products for photo jobs.`,
      bundle: "catalog",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/jobs/{id}" })
  .input(getJobInput)
  .output(getJobOutput)
  .handler(({ context, input }) =>
    getJob(
      { storeId: context.actor.storeId, id: input.id, waitSeconds: input.waitSeconds },
      {
        urls: context.ports.urls,
        store: context.store,
        authorize: (domain) => {
          if (!mayRead(context, domain)) throw platformErrors.permissionDenied(`${domain}:read`);
        },
      },
    ),
  );

export const dashboardJobsRouter = { get };
