import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
} from "@louez/api/platform/effects";

import { withEffectSignal } from "@/lib/api/effect-signal";
import { captureProductServerEventOrThrow } from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import { agentSetupActionProperties } from "@/lib/product-analytics/setup-analytics";

// The sender of an agent's setup action (packages/api
// platform/setup-analytics.ts): one PostHog event per row, with the row's id
// and time on every try. It throws when PostHog did not take it (the row is
// retried) and answers `skipped` when analytics is not set up here.

type Payload = ApiEffectPayloads["store.agentSetupAction"];

/** What the sender calls. A test replaces it, so nothing leaves the machine. */
export interface StoreSetupEffectDeps {
  captureProductServerEventOrThrow: typeof captureProductServerEventOrThrow;
}

export function createStoreSetupEffectSenders(
  overrides: Partial<StoreSetupEffectDeps> = {},
): Pick<ApiEffectSenders, "store.agentSetupAction"> {
  const deps: StoreSetupEffectDeps = { captureProductServerEventOrThrow, ...overrides };
  return {
    "store.agentSetupAction": (payload: Payload, context: EffectSendContext) =>
      withEffectSignal(context, async () => {
        await context.assertClaim();
        return deps.captureProductServerEventOrThrow({
          distinctId: payload.ownerUserId,
          event: productAnalyticsEvents.agentStoreSetupAction,
          properties: agentSetupActionProperties(payload),
          // The same event id and time on every try: PostHog keeps one event.
          identity: { eventUuid: payload.eventUuid, occurredAt: payload.occurredAt },
        });
      }),
  };
}
