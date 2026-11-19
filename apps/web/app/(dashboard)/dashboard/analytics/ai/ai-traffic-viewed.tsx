"use client";

import { useEffect, useRef } from "react";

import { useVisibilityAnalytics } from "@/components/dashboard/visibility/use-visibility-analytics";

/** Counts one view of the AI sources of Analyses (docs/analytics/visibility.md); renders nothing. */
export const AiTrafficViewed = ({
  storeId,
  aiVisits,
  aiCrawls,
}: {
  storeId: string;
  aiVisits: number;
  aiCrawls: number;
}) => {
  const analytics = useVisibilityAnalytics(storeId);
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    analytics.aiViewed("analytics", { readyCount: 0, itemCount: 0, aiVisits, aiCrawls });
  }, [analytics, aiVisits, aiCrawls]);
  return null;
};
