import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
} from "@louez/api/platform/effects";

import { withEffectSignal } from "@/lib/api/effect-signal";
import { captureProductServerEventOrThrow } from "@/lib/product-analytics/analytics";
import { lifecycleAnalyticsBaseProperties } from "@/lib/product-analytics/analytics-events";

// The sender of a store's lifecycle rows (docs/analytics/lifecycle.md): one
// PostHog event on the store owner's person, with the row's store as its
// store_id and store group. Throws when PostHog did not take it (the row is
// retried) and answers `skipped` when analytics is not set up here.

type Payload = ApiEffectPayloads["store.lifecycleAnalytics"];

/** What the sender calls. A test replaces it, so nothing leaves the machine. */
export interface StoreLifecycleEffectDeps {
  captureProductServerEventOrThrow: typeof captureProductServerEventOrThrow;
}

export function createStoreLifecycleEffectSenders(
  overrides: Partial<StoreLifecycleEffectDeps> = {},
): Pick<ApiEffectSenders, "store.lifecycleAnalytics"> {
  const deps: StoreLifecycleEffectDeps = { captureProductServerEventOrThrow, ...overrides };
  return {
    "store.lifecycleAnalytics": (payload: Payload, context: EffectSendContext) =>
      withEffectSignal(context, async () => {
        await context.assertClaim();
        return deps.captureProductServerEventOrThrow({
          distinctId: payload.ownerUserId,
          event: payload.event,
          properties: {
            ...lifecycleAnalyticsBaseProperties,
            ...payload.properties,
            // The row's own store, whatever the payload says.
            store_id: context.row.storeId,
          },
          // The same event id and time on every try: PostHog keeps one event.
          identity: { eventUuid: payload.eventUuid, occurredAt: payload.occurredAt },
        });
      }),
  };
}
