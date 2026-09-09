import type { StorefrontCartResolveInput } from "@louez/validations";

import { orpc } from "@/lib/orpc/react";

/**
 * A resolution is a snapshot of prices and other people's reservations: 30 s
 * matches the availability cache, so reopening the drawer does not refetch.
 */
const CART_RESOLVE_STALE_TIME = 30_000;

/** Query options for the cart resolution; the context is the only caller. */
export const cartQueries = {
  resolve: (input: StorefrontCartResolveInput) =>
    orpc.storefront.cart.resolve.queryOptions({
      input,
      staleTime: CART_RESOLVE_STALE_TIME,
      refetchOnWindowFocus: true,
    }),
  /** Broad key for invalidating every resolution once a reservation is placed. */
  resolveKey: () => orpc.storefront.cart.resolve.key(),
};
