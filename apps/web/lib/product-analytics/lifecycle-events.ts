import "server-only";

import {
  analyticsEventIdentity,
  enqueueEffects,
  stableAnalyticsEventIdentity,
  type StoreLifecycleEvent,
} from "@louez/api/platform/effects";
import { db, stores } from "@louez/db";
import { eq } from "drizzle-orm";

import { dispatchApiEffects } from "@/lib/api/effects";
import { log } from "@/lib/evlog";

/**
 * Queues one lifecycle event of a store on its owner's person, for a write
 * that has already committed (a Stripe webhook): its own outbox row, sent
 * after the response and retried by the cron. With `dedupKey`, every report
 * of the same fact (a redelivered Stripe event) carries the same event id and
 * time, so PostHog keeps one event. Never throws: analytics must not fail the
 * webhook that reports a payment or a plan.
 */
export async function queueStoreLifecycleEvent(input: {
  storeId: string;
  event: StoreLifecycleEvent;
  properties: Record<string, string | number | boolean | null>;
  /** The fact's own key, as `stripe_event:evt_…`; without it, a new id. */
  dedupKey?: string;
  /** The provider's time of the fact; defaults to now. */
  occurredAt?: Date;
}): Promise<void> {
  try {
    const occurredAt = input.occurredAt ?? new Date();
    const ids = await db.transaction(async (tx) => {
      const store = await tx.query.stores.findFirst({
        where: eq(stores.id, input.storeId),
        columns: { userId: true },
      });
      if (!store) return [];
      return enqueueEffects(tx, input.storeId, [
        {
          type: "store.lifecycleAnalytics",
          payload: {
            ...(input.dedupKey
              ? stableAnalyticsEventIdentity(input.dedupKey, occurredAt)
              : analyticsEventIdentity(occurredAt)),
            event: input.event,
            ownerUserId: store.userId,
            properties: input.properties,
          },
        },
      ]);
    });
    dispatchApiEffects(ids);
  } catch (error) {
    log.error({
      lifecycleAnalytics: {
        event: input.event,
        storeId: input.storeId,
        issue: "queue_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
