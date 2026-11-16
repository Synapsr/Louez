import { queryOptions } from "@tanstack/react-query";

import { loadNeedsALookWithin } from "@/lib/inbox/needs-a-look";
import { orpcClient } from "@/lib/orpc/client";

/** The store's own key: a read of one store never answers for another. */
const summaryKey = (storeId: string) => ["dashboard", "needs-a-look", "summary", storeId] as const;

export const needsALookQueries = {
  /**
   * What needs a look in the current store, for the notification bell: fetched
   * after paint, as the sidebar's AI credits are, never by the layout nor in the
   * bell's 30-second poll; kept a minute. A slow, failing or refused read
   * (`NEEDS_A_LOOK_TIMEOUT_MS`) leaves the query in error, and the bell shows
   * none of it.
   */
  summary: (storeId: string) =>
    queryOptions({
      queryKey: summaryKey(storeId),
      queryFn: ({ signal }) => loadNeedsALookWithin(orpcClient.dashboard.inbox, { signal }),
      staleTime: 60_000,
      retry: false,
    }),
  summaryKey,
};
