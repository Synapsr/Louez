"use client";

import { useEffect } from "react";

import { usePublicEnv } from "@/components/shared/public-env-provider";
import { initializePostHog } from "@/lib/posthog-client";

export const PostHogBootstrap = (): null => {
  const publicEnv = usePublicEnv();

  useEffect(() => {
    // This component is rendered before the application subtree so route-level
    // analytics effects see an initialized client without build-time env reads.
    initializePostHog(publicEnv);
  }, [publicEnv]);

  return null;
};
