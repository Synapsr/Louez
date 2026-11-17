import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
} from "@louez/api/platform/effects";

import { withEffectSignal } from "@/lib/api/effect-signal";
import { captureProductServerEventOrThrow } from "@/lib/product-analytics/analytics";

// The senders of a test reservation's outbox rows (packages/api
// services/test-reservations.ts): its analytics events (started, managed,
// deleted), sent to PostHog or skipped when analytics is not set up here
// (self-hosted), and the deletion of a deleted test reservation's stored
// files, retried until storage takes it.

/** What the senders call. A test replaces them, so nothing leaves the machine. */
export interface TestReservationEffectDeps {
  captureProductServerEventOrThrow: typeof captureProductServerEventOrThrow;
  deleteFile: (key: string) => Promise<void>;
}

const defaultDeps: TestReservationEffectDeps = {
  captureProductServerEventOrThrow,
  // The storage client loads only when a file is deleted.
  deleteFile: async (key) => {
    const [{ getImageFiles }, { FilesError }] = await Promise.all([
      import("@/lib/storage/files"),
      import("files-sdk"),
    ]);
    try {
      await getImageFiles().delete(key);
    } catch (error) {
      // Already gone: done.
      if (!(error instanceof FilesError && error.code === "NotFound")) throw error;
    }
  },
};

export function createTestReservationEffectSenders(
  overrides: Partial<TestReservationEffectDeps> = {},
): Pick<ApiEffectSenders, "testReservation.analytics" | "testReservation.deleteFiles"> {
  const deps: TestReservationEffectDeps = { ...defaultDeps, ...overrides };

  return {
    "testReservation.analytics": (
      payload: ApiEffectPayloads["testReservation.analytics"],
      context: EffectSendContext,
    ) =>
      withEffectSignal(context, async () => {
        await context.assertClaim();
        return deps.captureProductServerEventOrThrow({
          distinctId: payload.distinctId,
          event: payload.event,
          identity: { eventUuid: payload.eventUuid, occurredAt: payload.occurredAt },
          properties: {
            feature: "test_reservation",
            surface: "dashboard",
            ...payload.properties,
            store_id: context.row.storeId,
          },
        });
      }),
    "testReservation.deleteFiles": (
      payload: ApiEffectPayloads["testReservation.deleteFiles"],
      context: EffectSendContext,
    ) =>
      withEffectSignal(context, async () => {
        // Only the row's own store's files, whatever the payload names.
        const keys = payload.keys.filter((key) => key.startsWith(`${context.row.storeId}/`));
        for (const key of keys) {
          context.throwIfAborted();
          await deps.deleteFile(key);
        }
      }),
  };
}
