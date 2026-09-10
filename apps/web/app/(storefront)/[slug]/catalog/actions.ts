"use server";

import { z } from "zod";

import { CATALOG_SORT_VALUES } from "@/lib/storefront/catalog.constants";
import {
  type CatalogProductsPage,
  loadCatalogProducts,
  loadCatalogPriceIndex,
} from "@/lib/storefront/catalog.queries";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

const priceBound = z.number().nonnegative().max(1_000_000).nullable();
const isoDateTime = z.string().datetime({ offset: true }).nullable();

const loadMoreInputSchema = z.object({
  slug: z.string().trim().min(1).max(64),
  category: z.string().trim().min(1).max(64).nullable(),
  search: z.string().trim().max(120),
  minPrice: priceBound,
  maxPrice: priceBound,
  availableOnly: z.boolean().default(true),
  quantity: z.number().int().min(2).max(999).nullable(),
  attributes: z.record(z.string().min(1).max(64), z.array(z.string().min(1).max(120)).max(40)),
  startDate: isoDateTime,
  endDate: isoDateTime,
  sort: z.enum(CATALOG_SORT_VALUES),
  cursor: z.string().min(1).max(256).nullable(),
});

export type LoadMoreCatalogProductsInput = z.infer<typeof loadMoreInputSchema>;

export type CatalogQueryPage = CatalogProductsPage & { priceBounds: { min: number; max: number } };

/** Public catalog data, also used to refresh the first page after its cache expires. */
export const loadMoreCatalogProducts = async (
  rawInput: LoadMoreCatalogProductsInput,
): Promise<CatalogQueryPage> => {
  const input = loadMoreInputSchema.parse(rawInput);
  const store = await getStoreBySlug(input.slug);
  if (!store) throw new Error("Store not found");

  const [page, priceIndex] = await Promise.all([
    loadCatalogProducts({
      storeId: store.id,
      category: input.category,
      search: input.search,
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      quantity: input.quantity,
      availableOnly: input.availableOnly,
      attributes: input.attributes,
      startDate: input.startDate,
      endDate: input.endDate,
      sort: input.sort,
      cursor: input.cursor ?? undefined,
    }),
    loadCatalogPriceIndex(store.id, input.startDate, input.endDate),
  ]);
  return { ...page, priceBounds: priceIndex.bounds };
};
