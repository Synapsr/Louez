import { queryOptions } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc/react";

export const visibilityQueries = {
  /** The "Se faire connaître" guide: its steps and the visits shared links brought. */
  get: () =>
    queryOptions({
      ...orpc.dashboard.visibility.get.queryOptions({ input: {} }),
      staleTime: 30_000,
    }),
  /** « Être trouvé par les IA »: readiness, visits from assistants, AI crawler reads. */
  getAi: () =>
    queryOptions({
      ...orpc.dashboard.visibility.getAi.queryOptions({ input: {} }),
      staleTime: 30_000,
    }),
  /** Broad key, for invalidating after a step changes. */
  key: () => orpc.dashboard.visibility.key(),
};

export const visibilityMutations = {
  /** Marks a step done or skipped, or reopens it. */
  setStep: () => orpc.dashboard.visibility.setStep.mutationOptions(),
};
