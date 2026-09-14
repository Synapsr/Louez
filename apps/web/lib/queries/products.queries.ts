import { orpc } from "@/lib/orpc/react";

export interface ProductsListInput {
  status?: "all" | "active" | "draft" | "archived";
  /** Empty means "all categories"; a product in any of them is kept. */
  categoryIds?: string[];
  /** Part of the product name; empty means no search. */
  search?: string;
}

export const productsQueries = {
  list: (input: ProductsListInput = {}) =>
    orpc.dashboard.products.list.queryOptions({ input }),
  /** Broad key for invalidating every filter combination after a mutation. */
  listKey: () => orpc.dashboard.products.list.key(),
};
