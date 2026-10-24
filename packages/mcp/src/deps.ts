import type { ReservationStatus } from "@louez/db";

export interface McpStatusChangeInput {
  storeId: string;
  reservationId: string;
  to: ReservationStatus;
  actor: "mcp";
  actorUserId: string;
  /** Kept only when `to` is `rejected`. */
  rejectionReason?: string;
}

export type McpStatusChangeResult =
  | {
      ok: true;
      number: string;
      from: ReservationStatus;
      to: ReservationStatus;
      /** What the dashboard shows after the change, as translation keys. */
      warnings: ReadonlyArray<{ key: string; params?: Record<string, string | number> }>;
    }
  | { ok: false; error: "not_found" }
  /** `message` is the answer to give. */
  | { ok: false; error: "refused"; message: string };

/**
 * What the app gives the MCP server. packages/mcp cannot import apps/web, so
 * the HTTP route passes these in.
 */
export interface McpServerDeps {
  /**
   * Changes a reservation's status as the dashboard does: the stock check, the
   * fees, the insurance contract, the emails and the notifications.
   */
  changeReservationStatus: (input: McpStatusChangeInput) => Promise<McpStatusChangeResult>;
}
