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
  .route({
    method: "GET",
    path: "/jobs/{id}",
    description: `Returns where a background job stands, such as an AI photo enhancement or a background removal: \`queued\`, \`running\`, \`succeeded\` with its result, or \`failed\` with its \`error\` (nothing is charged for a failed run). \`waitSeconds\` (0 by default, ${JOB_WAIT_SECONDS_MAX} at most) waits for the job to end before answering; \`pollAfterSeconds\` says when to read it again. Photo jobs are started by \`POST /products/{id}/images/enhance\` and \`POST /products/{id}/images/remove-background\`. For a photo job, \`source\` is the photo before; once the job succeeded, \`result\` is the photo after, which replaced it on the product, with \`creditsCharged\`. \`source.versionId\` is the original's version id, which \`POST /products/{id}/images/use-version\` takes to put it back. \`links.dashboard\` is the product's page in the Louez dashboard and, while the product is active, \`links.storefront\` its page on the storefront. Needs a key that can read the job's domain, products for photo jobs (\`PERMISSION_DENIED\` otherwise); an unknown id answers \`JOB_NOT_FOUND\`.`,
  })
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
