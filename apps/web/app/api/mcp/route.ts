import { handleMcpRequest, handleMcpDelete, handleMcpDiscovery } from "@louez/mcp/http";

import { runReservationEffects } from "@/lib/billing/reservation-effects";

// The app code the MCP tools need. packages/mcp cannot import it.
const mcpDeps = { runReservationEffects };

export async function POST(request: Request) {
  return handleMcpRequest(request, mcpDeps);
}

export async function GET(request: Request) {
  // If session ID present, this is an SSE stream request — delegate to transport
  if (request.headers.get("mcp-session-id")) {
    return handleMcpRequest(request, mcpDeps);
  }
  // Otherwise, return server discovery metadata
  return handleMcpDiscovery();
}

export async function DELETE(request: Request) {
  return handleMcpDelete(request);
}
