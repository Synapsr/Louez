import { createExposure } from "@louez/api/platform/exposure";
import { createOpenApiHandler, handleOpenApiRequest } from "@louez/api/platform/openapi";
import { appRouter } from "@louez/api/router";

import { env } from "@/env";
import { apiPorts } from "@/lib/api/ports";
import { log, useLogger, withEvlog } from "@/lib/evlog";

// Only the procedures of the exposure registry. The spec
// (/api/v1/openapi.json) and its reference (/api/v1/docs) are served in
// development only: in production they answer 404.
const handler = createOpenApiHandler(createExposure(appRouter).router, {
  docs: env.NODE_ENV === "development",
  onError: (error) => {
    const apiError = error instanceof Error ? error : new Error("Unknown oRPC error");
    try {
      useLogger().error(apiError, { step: "openapi" });
    } catch {
      log.error("openapi", apiError.message);
    }
  },
});

async function handleRequest(request: Request) {
  const url = new URL(request.url);
  useLogger().set({ api: { path: url.pathname, method: request.method } });

  const response = await handleOpenApiRequest(handler, request, { ports: apiPorts });
  return response ?? Response.json({ message: "Not found" }, { status: 404 });
}

export const GET = withEvlog(handleRequest);
export const POST = withEvlog(handleRequest);
export const PUT = withEvlog(handleRequest);
export const PATCH = withEvlog(handleRequest);
export const DELETE = withEvlog(handleRequest);
