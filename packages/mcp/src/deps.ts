import type { ReservationEffectRunner } from "@louez/db";

/**
 * What the app gives the MCP server. packages/mcp cannot import apps/web, so
 * the HTTP route passes these in.
 */
export interface McpServerDeps {
  /** Runs the fee effects of a committed status change. */
  runReservationEffects: ReservationEffectRunner;
}
