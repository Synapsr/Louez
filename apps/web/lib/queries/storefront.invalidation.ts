import type { QueryClient } from "@tanstack/react-query";

import { cartQueries } from "./cart.queries";
import { catalogQueries } from "./catalog.queries";
import { storefrontQueries } from "./storefront.queries";

/** A reservation change can affect stock, available combinations and cart totals. */
export const invalidateStorefrontReservationData = async (
  queryClient: QueryClient,
): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: cartQueries.resolveKey() }),
    queryClient.invalidateQueries({ queryKey: catalogQueries.key() }),
    queryClient.invalidateQueries({ queryKey: storefrontQueries.availabilityKey() }),
  ]);
};
