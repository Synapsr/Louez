import { type QueryClient, queryOptions } from "@tanstack/react-query";

import { loadNeedsALookWithin } from "@/lib/inbox/needs-a-look";
import { orpcClient } from "@/lib/orpc/client";

/**
 * The store's own key: within a page's life, one store's cached read never
 * answers for another. The request itself follows the session's active store,
 * as every dashboard call does.
 */
const summaryKey = (storeId: string) => ["dashboard", "needs-a-look", "summary", storeId] as const;

/** How long an answer, or a failure, stands before a new page reads again. */
const NEEDS_A_LOOK_FRESH_MS = 60_000;

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
      staleTime: NEEDS_A_LOOK_FRESH_MS,
      retry: false,
    }),
  summaryKey,
  /**
   * Reads the store's items again. They change through other screens (a refund
   * sent again, an invitation cancelled), which do not know this query: the
   * bell calls this on each page, where it reads only once the last answer or
   * failure is a minute old, and with `always` when the person opens it.
   */
  readAgain: (client: QueryClient, storeId: string, { always = false } = {}) =>
    client.refetchQueries({
      queryKey: summaryKey(storeId),
      predicate: ({ state }) =>
        always ||
        Date.now() - Math.max(state.dataUpdatedAt, state.errorUpdatedAt) >= NEEDS_A_LOOK_FRESH_MS,
    }),
};
