import type { ApiPorts } from "@louez/api";
import { CONFIRMATION_HEADER } from "@louez/api/platform/confirmation";
import { IDEMPOTENCY_HEADER } from "@louez/api/platform/operations";
import { STORE_HEADER } from "@louez/api/platform/procedures";
import { appRouter } from "@louez/api/router";
import { createRouterClient } from "@orpc/server";

import type { AssistantApi, AssistantApiContext } from "./tools";

/**
 * The request's headers (its session cookie) with the store pinned to
 * `storeId`, and nothing the browser sent that a write reads as the caller's
 * own choice: no confirmation token or approval id, no idempotency key. An
 * approval id reaches a procedure only from the tool that presents it
 * (`AssistantApiContext.approvalId`).
 */
function assistantHeaders(headers: Headers, storeId: string, approvalId?: string): Headers {
  const pinned = new Headers(headers);
  pinned.delete(CONFIRMATION_HEADER);
  pinned.delete(IDEMPOTENCY_HEADER);
  pinned.set(STORE_HEADER, storeId);
  if (approvalId) pinned.set(CONFIRMATION_HEADER, approvalId);
  return pinned;
}

/**
 * The procedures the in-app assistant calls, as the signed-in user of this
 * request, on the chat's store. Every client's context is marked as the
 * assistant's (`assistant: true`): the one place that sets the mark, from
 * the server's code, never from the request. With it, a branch whose
 * consequence is live (money, stock overrides, access taken away) asks the
 * person's approval on its page, as for a connected agent; everything else
 * runs as the session does (platform/approval-rule.ts).
 */
export function createAssistantApi(input: {
  headers: Headers;
  storeId: string;
  ports: ApiPorts;
}): AssistantApi {
  const context = ({ approvalId }: AssistantApiContext = {}) => ({
    headers: assistantHeaders(input.headers, input.storeId, approvalId),
    transport: "rpc" as const,
    ports: input.ports,
    assistant: true as const,
  });
  const { dashboard } = appRouter;
  return {
    analytics: createRouterClient(dashboard.analytics, {
      context,
      path: ["dashboard", "analytics"],
    }),
    categories: createRouterClient(dashboard.categories, {
      context,
      path: ["dashboard", "categories"],
    }),
    payments: createRouterClient(dashboard.payments, {
      context,
      path: ["dashboard", "payments"],
    }),
    products: createRouterClient(dashboard.products, {
      context,
      path: ["dashboard", "products"],
    }),
    reservations: createRouterClient(dashboard.reservations, {
      context,
      path: ["dashboard", "reservations"],
    }),
    settings: createRouterClient(dashboard.settings, {
      context,
      path: ["dashboard", "settings"],
    }),
  };
}
