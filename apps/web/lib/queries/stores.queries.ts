import { queryOptions } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc/react";

export const storesQueries = {
  /** What the active store still lacks: the home's setup checklist, as agents read it. */
  launchChecklist: () =>
    queryOptions(orpc.dashboard.stores.getLaunchChecklist.queryOptions({ input: {} })),
};
