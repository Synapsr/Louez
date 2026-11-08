import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
} from "@louez/api/platform/effects";

import { withEffectSignal } from "@/lib/api/effect-signal";
import { sendPlatformStoreLaunched } from "@/lib/discord/platform-notifications";
import { captureProductServerEventOrThrow } from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";

// The senders of a store's launch rows (packages/api services/launch.ts): the
// platform's notice on each channel, and the onboarding's completion event.
// Each throws when nothing went out (the row is retried) and answers
// `skipped` when there is nothing to do.

type Payload<K extends keyof ApiEffectPayloads> = ApiEffectPayloads[K];
type Outcome = Promise<void | { skipped: string }>;
type StoreLaunchEffectType = "store.launchNotification" | "store.launchAnalytics";

/** What the senders call. A test replaces them, so nothing leaves the machine. */
export interface StoreLaunchEffectDeps {
  sendPlatformStoreLaunched: typeof sendPlatformStoreLaunched;
  captureProductServerEventOrThrow: typeof captureProductServerEventOrThrow;
}

const defaultDeps: StoreLaunchEffectDeps = {
  sendPlatformStoreLaunched,
  captureProductServerEventOrThrow,
};

export function createStoreLaunchEffectSenders(
  overrides: Partial<StoreLaunchEffectDeps> = {},
): Pick<ApiEffectSenders, StoreLaunchEffectType> {
  const deps: StoreLaunchEffectDeps = { ...defaultDeps, ...overrides };
  const guarded =
    <P>(send: (payload: P, context: EffectSendContext) => Outcome) =>
    (payload: P, context: EffectSendContext) =>
      withEffectSignal(context, () => send(payload, context));

  return {
    "store.launchNotification": guarded(
      async (payload: Payload<"store.launchNotification">, context: EffectSendContext): Outcome =>
        deps.sendPlatformStoreLaunched(payload.channel, payload.store, () => context.assertClaim()),
    ),
    "store.launchAnalytics": guarded(
      async (payload: Payload<"store.launchAnalytics">, context: EffectSendContext): Outcome => {
        await context.assertClaim();
        return deps.captureProductServerEventOrThrow({
          distinctId: payload.ownerUserId,
          event: productAnalyticsEvents.onboardingCompleted,
          properties: {
            feature: "onboarding",
            // The dashboard's events keep their surface; the API and agents set their own.
            surface: payload.transport === "rpc" ? "dashboard" : payload.transport,
            ...(payload.transport === "rpc" ? {} : { actor: payload.transport }),
            store_id: payload.storeId,
            reservation_mode: payload.reservationMode,
          },
          // The same event id and time on every try: PostHog keeps one event.
          identity: { eventUuid: payload.eventUuid, occurredAt: payload.occurredAt },
        });
      },
    ),
  };
}
