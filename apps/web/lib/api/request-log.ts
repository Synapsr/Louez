import type { RequestLogSink } from "@louez/api/platform/refusal-log";

import { log, useLogger } from "@/lib/evlog";

/**
 * The request log of a transport handler (`/api/v1`, `/api/rpc`): a refused call
 * goes on the request's wide event by its facts only (`apiRefusal`: its code, the
 * procedure, the store, who called, the ids it is about), never its message, its
 * preview or its stack; a fault is logged as it is (packages/api
 * platform/refusal-log.ts). Outside a request's logger, a line of its own.
 */
export const requestLog = (step: string): RequestLogSink => ({
  refusal: (event) => {
    try {
      useLogger().set({ apiRefusal: event });
    } catch {
      log.warn({ apiRefusal: { step, ...event } });
    }
  },
  fault: (error) => {
    try {
      useLogger().error(error, { step });
    } catch {
      log.error(step, error.message);
    }
  },
});
