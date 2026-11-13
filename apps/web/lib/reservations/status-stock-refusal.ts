import type { CapacityShortfall } from "@louez/api/contracts/reservations";

/**
 * The store's confirmation refused for its stock, as the dashboard shows it:
 * - `capacity` (`RESERVATION_INSUFFICIENT_CAPACITY`): the stock cannot cover
 *   these lines; the overbooking dialog lists them and may confirm anyway;
 * - `buffer` (`RESERVATION_TURNOVER_BUFFER_CONFLICT`): the lines fit the
 *   stock, not the turnover buffer; no "confirm anyway".
 *
 * Null for any other error, or a refusal without its shortfalls. No server import.
 */
export type StatusStockRefusal =
  | { kind: "capacity"; shortfalls: CapacityShortfall[] }
  | { kind: "buffer"; shortfalls: CapacityShortfall[] };

const KIND_BY_CODE: Record<string, StatusStockRefusal["kind"]> = {
  RESERVATION_INSUFFICIENT_CAPACITY: "capacity",
  RESERVATION_TURNOVER_BUFFER_CONFLICT: "buffer",
};

const isShortfall = (value: unknown): value is CapacityShortfall =>
  typeof value === "object" &&
  value !== null &&
  "productId" in value &&
  typeof value.productId === "string" &&
  "productName" in value &&
  typeof value.productName === "string" &&
  "combinationKey" in value &&
  (value.combinationKey === null || typeof value.combinationKey === "string") &&
  "requested" in value &&
  typeof value.requested === "number" &&
  "available" in value &&
  typeof value.available === "number";

export const readStatusStockRefusal = (error: unknown): StatusStockRefusal | null => {
  if (!(error instanceof Error)) return null;
  const data: unknown = "data" in error ? error.data : undefined;
  if (!data || typeof data !== "object" || !("code" in data) || !("details" in data)) return null;
  const kind = typeof data.code === "string" ? KIND_BY_CODE[data.code] : undefined;
  if (!kind) return null;
  const { details } = data;
  if (!details || typeof details !== "object" || !("shortfalls" in details)) return null;
  const { shortfalls } = details;
  if (!Array.isArray(shortfalls) || shortfalls.length === 0 || !shortfalls.every(isShortfall)) {
    return null;
  }
  return { kind, shortfalls };
};
