import type { McpPaymentDeps } from "./tools/payments";

/**
 * What the app gives the MCP server. packages/mcp cannot import apps/web, so
 * the HTTP route passes these in.
 */
export type McpServerDeps = McpPaymentDeps;
