import { queryOptions } from "@tanstack/react-query";

import { orpcClient } from "@/lib/orpc/client";
import { orpc } from "@/lib/orpc/react";

type SeasonalPricingPage = Awaited<
  ReturnType<typeof orpcClient.dashboard.products.listSeasonalPricings>
>;

export interface ProductsListInput {
  status?: "all" | "active" | "draft" | "archived";
  /** Empty means "all categories"; a product in any of them is kept. */
  categoryIds?: string[];
  /** Part of the product name; empty means no search. */
  search?: string;
}

export const productsQueries = {
  /** The first page of the products list (100 products), as the dashboard shows it. */
  list: (input: ProductsListInput = {}) => orpc.dashboard.products.list.queryOptions({ input }),
  /** Broad key for invalidating every filter combination after a mutation. */
  listKey: () => orpc.dashboard.products.list.key(),
  /** Every key of the products domain: lists, products, seasons, timelines. */
  key: () => orpc.dashboard.products.key(),
  /**
   * Every season of a product, by start day: the pages read one after the
   * other, under the list's own key.
   */
  seasonalPricings: (productId: string) =>
    queryOptions({
      queryKey: orpc.dashboard.products.listSeasonalPricings.queryOptions({
        input: { productId },
      }).queryKey,
      queryFn: async ({ signal }): Promise<SeasonalPricingPage> => {
        const items: SeasonalPricingPage["items"] = [];
        let cursor: string | undefined;
        do {
          const page = await orpcClient.dashboard.products.listSeasonalPricings(
            { productId, cursor },
            { signal },
          );
          items.push(...page.items);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return { items, nextCursor: null };
      },
    }),
  /** Reservations and unit downtimes of a product over a window. */
  reservationTimeline: (input: { id: string; from: Date; to: Date }) =>
    orpc.dashboard.products.getReservationTimeline.queryOptions({ input }),
};
