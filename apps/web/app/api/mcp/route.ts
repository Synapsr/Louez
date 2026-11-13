import { mcpOAuth } from "@louez/auth";
import { handleMcpRequest, type McpHttpOptions } from "@louez/mcp/http";
import { createExposure } from "@louez/api/platform/exposure";
import { appRouter } from "@louez/api/router";

import { apiPorts } from "@/lib/api/ports";

const options: McpHttpOptions = {
  ports: apiPorts,
  procedures: createExposure(appRouter).procedures,
  // A 401 points MCP clients (Claude.ai, ChatGPT…) to where they sign in.
  resourceMetadataUrl: mcpOAuth?.resourceMetadataUrl,
};

// Stateless Streamable HTTP: every request is authorized on its own, with an
// API key or an OAuth access token. GET and DELETE get 405 from the SDK, as
// there is no session.
async function handle(request: Request) {
  return handleMcpRequest(request, options);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
