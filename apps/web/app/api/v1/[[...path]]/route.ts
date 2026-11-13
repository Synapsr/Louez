import { createExposure } from "@louez/api/platform/exposure";
import {
  createApiReference,
  createOpenApiHandler,
  handleOpenApiRequest,
  routeBodyLimits,
} from "@louez/api/platform/openapi";
import { appRouter } from "@louez/api/router";

import { apiPorts } from "@/lib/api/ports";
import { log, useLogger, withEvlog } from "@/lib/evlog";

// Only the procedures of the exposure registry. A body stops at 2 MiB, more
// for the procedures that take more (routeBodyLimits: an image's bytes, a
// product with its units). The OpenAPI document (/api/v1/openapi.json) and
// its reference (/api/v1/docs) are public, in every environment: anyone reads
// them without a key, and the document names this deployment's URL.
const exposure = createExposure(appRouter);
const handler = createOpenApiHandler(exposure.router, {
  onError: (error) => {
    const apiError = error instanceof Error ? error : new Error("Unknown oRPC error");
    try {
      useLogger().error(apiError, { step: "openapi" });
    } catch {
      log.error("openapi", apiError.message);
    }
  },
});
const reference = createApiReference(exposure.router);

const bodyLimits = routeBodyLimits(exposure.procedures);

async function handleRequest(request: Request) {
  const url = new URL(request.url);
  useLogger().set({ api: { path: url.pathname, method: request.method } });

  const response = await handleOpenApiRequest(handler, request, {
    ports: apiPorts,
    bodyLimits,
    reference,
  });
  return response ?? Response.json({ message: "Not found" }, { status: 404 });
}

export const GET = withEvlog(handleRequest);
export const POST = withEvlog(handleRequest);
export const PUT = withEvlog(handleRequest);
export const PATCH = withEvlog(handleRequest);
export const DELETE = withEvlog(handleRequest);
