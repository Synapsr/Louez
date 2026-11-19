"use client";

import { useCallback } from "react";

import { usePostHog } from "posthog-js/react";

import type { AiReadinessItemKey } from "@louez/api/contracts/ai-visibility";
import type { VisitSource, VisibilityStepKey } from "@louez/api/contracts/visibility";

import {
  productAnalyticsEvents,
  visibilityAnalyticsBaseProperties,
} from "@/lib/product-analytics/analytics-events";

/** Where the guide's tools are shown (docs/analytics/visibility.md). */
export type VisibilityPlacement = "page" | "home_card" | "storefront_card";

/**
 * Where « Être trouvé par les IA » is shown: its own page, its summary on
 * « Se faire connaître », the AI sources view of Analyses.
 */
export type AiVisibilityPlacement = "page" | "summary" | "analytics";

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
    aiViewed: useCallback(
      (
        placement: AiVisibilityPlacement,
        facts: { readyCount: number; itemCount: number; aiVisits: number; aiCrawls: number },
      ) =>
        capture(productAnalyticsEvents.visibilityAiViewed, {
          placement,
          ready_count: facts.readyCount,
          item_count: facts.itemCount,
          ai_visits: facts.aiVisits,
          ai_crawls: facts.aiCrawls,
        }),
      [capture],
    ),
    /**
     * A readiness item's fix, or: `llms_txt` the file assistants read,
     * `ai_page` the AI page, `analytics` the AI sources view.
     */
    aiFixOpened: useCallback(
      (
        placement: AiVisibilityPlacement,
        item: AiReadinessItemKey | "llms_txt" | "ai_page" | "analytics",
      ) =>
        capture(productAnalyticsEvents.visibilityAiFixOpened, { placement, item }),
      [capture],
    ),
  };
};
