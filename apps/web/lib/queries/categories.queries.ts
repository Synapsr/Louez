import { queryOptions } from "@tanstack/react-query";

import { orpcClient } from "@/lib/orpc/client";
import { orpc } from "@/lib/orpc/react";

type CategoryPage = Awaited<ReturnType<typeof orpcClient.dashboard.categories.list>>;

export const categoriesQueries = {
  /**
   * Every category of the store, in the store's order: the pages of
   * `categories.list` read one after the other, under the list's own key so
   * `orpc.dashboard.categories.key()` invalidates it.
   */
  list: () =>
    queryOptions({
      queryKey: orpc.dashboard.categories.list.queryOptions({ input: {} }).queryKey,
      queryFn: async ({ signal }): Promise<CategoryPage> => {
        const items: CategoryPage["items"] = [];
        let cursor: string | undefined;
        do {
          const page = await orpcClient.dashboard.categories.list({ cursor }, { signal });
          items.push(...page.items);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return { items, nextCursor: null };
      },
      // Categories rarely change while browsing the catalog
      staleTime: 60_000,
    }),
};
