import type { McpServerDeps } from "@louez/mcp";
import { handleMcpRequest, type McpHttpOptions } from "@louez/mcp/http";
import { createExposure } from "@louez/api/platform/exposure";
import { appRouter } from "@louez/api/router";
import { nanoid } from "nanoid";

import { apiPorts } from "@/lib/api/ports";
import { insertRecordedPayment } from "@/lib/reservations/dashboard-payment-writes";
import { changeReservationStatusAsAgent } from "@/lib/reservations/status-change";

// The app code the hand-written MCP tools need. packages/mcp cannot import it.
// The payment id is made here because packages/mcp has no id generator.
const mcpDeps = {
  changeReservationStatus: changeReservationStatusAsAgent,
  insertRecordedPayment: (tx, payment) => insertRecordedPayment(tx, { ...payment, id: nanoid() }),
} satisfies McpServerDeps;

const options: McpHttpOptions = {
  deps: mcpDeps,
  ports: apiPorts,
  procedures: createExposure(appRouter).procedures,
};

// Stateless Streamable HTTP: every request is authorized on its own. GET and
// DELETE get 405 from the SDK, as there is no session.
async function handle(request: Request) {
  return handleMcpRequest(request, options);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
