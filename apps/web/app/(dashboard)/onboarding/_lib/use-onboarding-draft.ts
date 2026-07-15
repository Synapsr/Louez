"use client";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc/react";

// The draft changes as the user moves back and forth between steps, so always
// refetch on mount instead of trusting the cache.
export function useOnboardingDraft({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    ...orpc.dashboard.onboarding.getDraft.queryOptions({
      input: {},
    }),
    retry: false,
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
