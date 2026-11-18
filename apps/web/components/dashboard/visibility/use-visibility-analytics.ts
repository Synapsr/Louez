"use client";

import { useCallback } from "react";

import { usePostHog } from "posthog-js/react";

import type { VisitSource, VisibilityStepKey } from "@louez/api/contracts/visibility";

import {
  productAnalyticsEvents,
  visibilityAnalyticsBaseProperties,
} from "@/lib/product-analytics/analytics-events";

/** Where the guide's tools are shown (docs/analytics/visibility.md). */
export type VisibilityPlacement = "page" | "home_card" | "storefront_card";

/**
 * The guide's PostHog events, on the store's group. Codes only: never a
 * name, a message or a link.
 */
export const useVisibilityAnalytics = (storeId: string) => {
  const posthog = usePostHog();

  const capture = useCallback(
    (event: string, properties: Record<string, unknown>) => {
      posthog?.capture(event, {
        ...visibilityAnalyticsBaseProperties,
        store_id: storeId,
        $groups: { store: storeId },
        ...properties,
      });
    },
    [posthog, storeId],
  );

  return {
    viewed: useCallback(
      (placement: VisibilityPlacement, counts: { done: number; skipped: number }) =>
        capture(productAnalyticsEvents.visibilityViewed, {
          placement,
          done_count: counts.done,
          skipped_count: counts.skipped,
        }),
      [capture],
    ),
    shareUsed: useCallback(
      (placement: VisibilityPlacement, channel: VisitSource, target: "store" | "product") =>
        capture(productAnalyticsEvents.visibilityShareUsed, { placement, channel, target }),
      [capture],
    ),
    stepCompleted: useCallback(
      (step: VisibilityStepKey, status: "todo" | "done" | "skipped") =>
        capture(productAnalyticsEvents.visibilityStepCompleted, { step, status }),
      [capture],
    ),
  };
};
