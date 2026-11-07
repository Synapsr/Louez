import type { ExposedProcedure } from "@louez/api/platform/exposure";
import { McpServer } from "@modelcontextprotocol/server";

import type { McpRequestContext } from "./auth/context";
import { registerExposedTools } from "./bridge";
import type { McpServerDeps } from "./deps";
import { registerProductTools } from "./tools/products";
import { registerReservationTools } from "./tools/reservations";
import { registerCustomerTools } from "./tools/customers";
import { registerPaymentTools } from "./tools/payments";
import { registerAnalyticsTools } from "./tools/analytics";
import { registerSettingsTools } from "./tools/settings";
import { registerCalendarTools } from "./tools/calendar";
import { registerResources } from "./resources/index";
import { registerPrompts } from "./prompts/index";

/**
 * The MCP server for one request. The context is resolved for that request
 * (see `resolveMcpContext`), so every request reads the credential, the
 * membership and the role again. The exposed procedures come first; the
 * hand-written tools, resources and prompts follow until their domain moves to
 * procedures. The deps come from the app and reach the tools that need them.
 */
export function createMcpServer(
  ctx: McpRequestContext,
  deps: McpServerDeps,
  procedures: readonly ExposedProcedure[],
): McpServer {
  const server = new McpServer({
    name: "louez",
    version: "0.2.0",
  });

  registerExposedTools(server, ctx, procedures);

  // Hand-written tools, moved to procedures domain by domain
  registerProductTools(server, ctx);
  registerReservationTools(server, ctx, deps);
  registerCustomerTools(server, ctx);
  registerPaymentTools(server, ctx, deps);
  registerAnalyticsTools(server, ctx);
  registerSettingsTools(server, ctx);
  registerCalendarTools(server, ctx);

  // Register resources & prompts
  registerResources(server, ctx);
  registerPrompts(server, ctx);

  return server;
}
