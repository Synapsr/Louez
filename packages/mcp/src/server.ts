import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpSessionContext } from "./auth/context";
import type { McpServerDeps } from "./deps";
import { registerProductTools } from "./tools/products";
import { registerCategoryTools } from "./tools/categories";
import { registerReservationTools } from "./tools/reservations";
import { registerCustomerTools } from "./tools/customers";
import { registerPaymentTools } from "./tools/payments";
import { registerAnalyticsTools } from "./tools/analytics";
import { registerSettingsTools } from "./tools/settings";
import { registerCalendarTools } from "./tools/calendar";
import { registerResources } from "./resources/index";
import { registerPrompts } from "./prompts/index";

/**
 * Create a fully configured MCP server instance for a given session context.
 * The context is resolved once at connection time (from an API key) and
 * injected into every tool, resource, and prompt handler. The deps come from
 * the app and reach the tools that need them.
 */
export function createMcpServer(ctx: McpSessionContext, deps: McpServerDeps): McpServer {
  const server = new McpServer({
    name: "louez",
    version: "0.1.0",
  });

  // Register all tools
  registerProductTools(server, ctx);
  registerCategoryTools(server, ctx);
  registerReservationTools(server, ctx, deps);
  registerCustomerTools(server, ctx);
  registerPaymentTools(server, ctx);
  registerAnalyticsTools(server, ctx);
  registerSettingsTools(server, ctx);
  registerCalendarTools(server, ctx);

  // Register resources & prompts
  registerResources(server, ctx);
  registerPrompts(server, ctx);

  return server;
}
