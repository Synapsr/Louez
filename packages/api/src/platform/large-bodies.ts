import { ORPCError } from "@orpc/server";

import type { ApiErrorData } from "./errors";

/**
 * Requests reading a body past their transport's default (2 MiB on
 * `/api/v1`, 4 MiB on `/api/mcp`) at once in this process, both transports
 * together, each until it is answered. Past it, 503 and a retry.
 */
export const MAX_LARGE_BODY_READS = 4;
let reading = 0;

/**
 * A place for one large read, or null when every place is taken. The
 * returned function gives it back once the request is answered; calling it
 * again does nothing.
 */
export function takeLargeBodyPlace(): (() => void) | null {
  if (reading >= MAX_LARGE_BODY_READS) return null;
  reading++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    reading--;
  };
}

/** No place for a large read: retry in a second (`details.retryAfterSeconds`). */
export const largeBodyBusy = () =>
  new ORPCError<"SERVICE_UNAVAILABLE", ApiErrorData>("SERVICE_UNAVAILABLE", {
    message: "Too many large requests are being read right now. Try again in a few seconds.",
    data: { code: "LARGE_BODY_BUSY", retryable: true, details: { retryAfterSeconds: 1 } },
  });
