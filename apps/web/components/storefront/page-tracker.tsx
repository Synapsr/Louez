"use client";

import { useEffect } from "react";

import { useAnalytics, type PageType } from "@/contexts/analytics-context";

interface PageTrackerProps {
  page: PageType;
  productId?: string;
  categoryId?: string;
}

/** Records one page view for the funnel; renders nothing. */
export const PageTracker = ({ page, productId, categoryId }: PageTrackerProps) => {
  const { trackPageView } = useAnalytics();

  useEffect(() => {
    trackPageView({ page, productId, categoryId });
  }, [page, productId, categoryId, trackPageView]);

  return null;
};
