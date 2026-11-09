import type { ExposedProcedure } from "@louez/api/platform/exposure";
import { McpServer } from "@modelcontextprotocol/server";

import type { McpRequestContext } from "./auth/context";
import { registerExposedTools } from "./bridge";
import type { McpServerDeps } from "./deps";
import { serverInstructions } from "./instructions";
import { registerCustomerTools } from "./tools/customers";
import { registerPaymentTools } from "./tools/payments";
import { registerAnalyticsTools } from "./tools/analytics";
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
  const { urls } = ctx.ports;
  const server = new McpServer(
    {
      name: "louez",
      title: "Louez",
      version: "0.4.0",
      description: "Run a rental store on Louez: reservations, products, customers and payments.",
      websiteUrl: urls.dashboard("/"),
      icons: [
        { src: urls.dashboard("/favicon.svg"), mimeType: "image/svg+xml", sizes: ["any"] },
        { src: urls.dashboard("/apple-touch-icon.png"), mimeType: "image/png", sizes: ["180x180"] },
      ],
    },
    { instructions: serverInstructions(ctx) },
  );

  registerExposedTools(server, ctx, procedures);

  // Hand-written tools, moved to procedures domain by domain
  registerCustomerTools(server, ctx);
  registerPaymentTools(server, ctx, deps);
  registerAnalyticsTools(server, ctx);
  registerCalendarTools(server, ctx);

  // Resources and prompts read one store. A connection over several stores
  // that named none gets the tools only (stores_list, then storeId).
  if (ctx.storeChosen) {
    registerResources(server, ctx);
    registerPrompts(server, ctx);
  }

  return server;
}
