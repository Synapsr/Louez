"use client";

import { useEffect, useRef } from "react";

import { useRouter } from "next/navigation";

interface StorefrontPageRefreshProps {
  renderedAt: number;
  maxAgeMs?: number;
}

/** Refresh an old account or checkout page when the visitor returns to it. */
export const StorefrontPageRefresh = ({
  renderedAt,
  maxAgeMs = 30_000,
}: StorefrontPageRefreshProps) => {
  const router = useRouter();
  const lastCheckedAt = useRef(renderedAt);

  useEffect(() => {
    lastCheckedAt.current = Math.max(lastCheckedAt.current, renderedAt);
    const refreshIfStale = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        now - lastCheckedAt.current < maxAgeMs
      )
        return;
      lastCheckedAt.current = now;
      router.refresh();
    };

    refreshIfStale();
    window.addEventListener("focus", refreshIfStale);
    window.addEventListener("online", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.removeEventListener("focus", refreshIfStale);
      window.removeEventListener("online", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, [maxAgeMs, renderedAt, router]);

  return null;
};
