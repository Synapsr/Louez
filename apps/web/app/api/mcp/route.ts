import type { McpServerDeps } from "@louez/mcp";
import { handleMcpRequest, handleMcpDelete, handleMcpDiscovery } from "@louez/mcp/http";
import { nanoid } from "nanoid";

import { insertRecordedPayment } from "@/lib/reservations/dashboard-payment-writes";
import { changeReservationStatusAsAgent } from "@/lib/reservations/status-change";

// The app code the MCP tools need. packages/mcp cannot import it. The payment id
// is made here because packages/mcp has no id generator.
const mcpDeps = {
  changeReservationStatus: changeReservationStatusAsAgent,
  insertRecordedPayment: (tx, payment) => insertRecordedPayment(tx, { ...payment, id: nanoid() }),
} satisfies McpServerDeps;

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
