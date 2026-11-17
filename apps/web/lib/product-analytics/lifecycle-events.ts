import {
  analyticsEventIdentity,
  enqueueEffects,
  stableAnalyticsEventIdentity,
  type StoreLifecycleEvent,
} from "@louez/api/platform/effects";
import { db, stores, type Transaction } from "@louez/db";
import { eq } from "drizzle-orm";

import { log } from "@/lib/evlog";

/** One lifecycle event of a store, on its owner's person (docs/analytics/lifecycle.md). */
export type StoreLifecycleEventInput = {
  storeId: string;
  event: StoreLifecycleEvent;
  properties: Record<string, string | number | boolean | null>;
} & (
  | {
      /**
       * The fact's own key, as `stripe_event:evt_…`: every report of the same fact (a
       * redelivered Stripe event) carries the same event id. PostHog keeps one event
       * only when the time is the same too, so it comes with the provider's time.
       */
      dedupKey: string;
      occurredAt: Date;
    }
  | { dedupKey?: undefined; occurredAt?: Date }
);

/**
 * Adds the event's outbox row in `tx`, the write's own transaction: it exists if and
 * only if the write commits. Answers the row ids, to dispatch once committed. A store
 * that no longer exists adds nothing.
 */
export async function enqueueStoreLifecycleEvent(
  tx: Transaction,
  input: StoreLifecycleEventInput,
): Promise<string[]> {
  const store = await tx.query.stores.findFirst({
    where: eq(stores.id, input.storeId),
    columns: { userId: true },
  });
  if (!store) return [];
  const identity =
    input.dedupKey === undefined
      ? analyticsEventIdentity(input.occurredAt ?? new Date())
      : stableAnalyticsEventIdentity(input.dedupKey, input.occurredAt);
  return enqueueEffects(tx, input.storeId, [
    {
      type: "store.lifecycleAnalytics",
      payload: {
        ...identity,
        event: input.event,
        ownerUserId: store.userId,
        properties: input.properties,
      },
    },
  ]);
}

/**
 * Queues one lifecycle event for a fact already committed elsewhere (a payment Stripe
 * took): its own outbox row. Answers its ids, for the caller to dispatch; the cron
 * sends it otherwise. Never throws: analytics must not fail the webhook that reports a
 * payment.
 */
export async function queueStoreLifecycleEvent(input: StoreLifecycleEventInput): Promise<string[]> {
  try {
    return await db.transaction((tx) => enqueueStoreLifecycleEvent(tx, input));
  } catch (error) {
    log.error({
      lifecycleAnalytics: {
        event: input.event,
        storeId: input.storeId,
        issue: "queue_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return [];
  }
}
