"use client";

import { useEffect, useRef } from "react";

import { usePostHog } from "posthog-js/react";

import { useStore } from "@/contexts/store-context";
import {
  homeNextStepAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";

import type { HomeNextStep } from "./util.next-step";

/**
 * Counts the home's next step card as shown, once per visit of the home
 * (docs/analytics/home.md). Renders nothing.
 */
export const HomeNextStepViewed = ({ step }: { step: HomeNextStep }) => {
  const posthog = usePostHog();
  const { storeId } = useStore();
  const counted = useRef(false);

  useEffect(() => {
    if (counted.current || !posthog) return;
    counted.current = true;
    posthog.capture(productAnalyticsEvents.homeNextStepViewed, {
      ...homeNextStepAnalyticsBaseProperties,
      store_id: storeId,
      $groups: { store: storeId },
      step,
    });
  }, [posthog, storeId, step]);

  return null;
};
