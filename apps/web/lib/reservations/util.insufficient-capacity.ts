import type { CapacityShortfall } from "@louez/api/contracts/reservations";

/**
 * The server's refusal of a reservation for lack of stock, with the lines it
 * could not cover: the answer the dashboard turns into the overbooking dialog.
 */
export const isInsufficientCapacityResult = (
  result: unknown,
): result is { error: "errors.insufficientCapacity"; shortfalls: CapacityShortfall[] } =>
  typeof result === "object" &&
  result !== null &&
  "error" in result &&
  result.error === "errors.insufficientCapacity" &&
  "shortfalls" in result &&
  Array.isArray(result.shortfalls);
