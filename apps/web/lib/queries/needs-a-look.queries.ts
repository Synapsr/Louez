import { queryOptions } from "@tanstack/react-query";

import { loadNeedsALookWithin } from "@/lib/inbox/needs-a-look";
import { orpcClient } from "@/lib/orpc/client";

const SUMMARY_KEY = ["dashboard", "needs-a-look", "summary"] as const;

export const needsALookQueries = {
  /**
   * What needs a look, for the sidebar's marker and the home's line: fetched
   * after paint, as the sidebar's AI credits are, never by the layout or the
   * page. One read serves both, kept a minute; a slow or failing inbox
   * (`NEEDS_A_LOOK_TIMEOUT_MS`) leaves the query in error, and both show nothing.
   */
  summary: () =>
    queryOptions({
      queryKey: SUMMARY_KEY,
      queryFn: ({ signal }) => loadNeedsALookWithin(orpcClient.dashboard.inbox, { signal }),
      staleTime: 60_000,
      retry: false,
    }),
  summaryKey: () => SUMMARY_KEY,
};
