import { queryOptions } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc/react";

export const testReservationQueries = {
  /** The store's test reservation and what its guide shows (testReservations.get). */
  get: () =>
    queryOptions({
      ...orpc.dashboard.testReservations.get.queryOptions({ input: {} }),
      staleTime: 30_000,
    }),
  /** Broad key, for invalidating after a test starts or is deleted. */
  key: () => orpc.dashboard.testReservations.key(),
};

export const testReservationMutations = {
  /** Deletes the test reservation and everything that hangs from it. */
  delete: () => orpc.dashboard.testReservations.delete.mutationOptions(),
};
