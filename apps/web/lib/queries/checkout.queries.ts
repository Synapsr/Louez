import { queryOptions } from "@tanstack/react-query";

import { getTulipQuotePreview } from "@/app/(storefront)/[slug]/checkout/actions";
import type { TulipQuotePreviewInput } from "@/app/(storefront)/[slug]/checkout/checkout.types";
import { orpc } from "@/lib/orpc/react";

/** A quote for the same customer, items and period never changes on its own. */
const TULIP_QUOTE_STALE_TIME = Infinity;
const TULIP_QUOTE_GC_TIME = 30 * 60_000;

export const checkoutQueries = {
  tulipQuote: (input: TulipQuotePreviewInput) =>
    queryOptions({
      queryKey: ["checkout", "tulip-quote-preview", input],
      queryFn: () => getTulipQuotePreview(input),
      staleTime: TULIP_QUOTE_STALE_TIME,
      gcTime: TULIP_QUOTE_GC_TIME,
      refetchOnWindowFocus: false,
    }),
};

export const checkoutMutations = {
  validatePromo: () => orpc.storefront.promo.validate.mutationOptions(),
};
