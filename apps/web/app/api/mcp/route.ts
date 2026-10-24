import { handleMcpRequest, handleMcpDelete, handleMcpDiscovery } from "@louez/mcp/http";

import { changeReservationStatusAsAgent } from "@/lib/reservations/status-change";

// The app code the MCP tools need. packages/mcp cannot import it.
const mcpDeps = { changeReservationStatus: changeReservationStatusAsAgent };

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
