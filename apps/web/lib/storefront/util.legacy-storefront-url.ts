import { isReservedCategoryValue } from "@/lib/storefront/catalog.constants";
import {
  buildCategoryBrowseHref,
  getCategoryToken,
} from "@/lib/utils/util.category-browse-entries";

/** A storefront request that may still address a product or a category by id. */
export type StorefrontPathTarget =
  | { kind: "product"; ref: string; search: URLSearchParams }
  | { kind: "catalog"; categoryToken: string; search: URLSearchParams };

/**
 * The product or category a store-relative path points at, or null for any
 * other page. `path` is the visitor's own URL (`/product/abc?startDate=…`),
 * without the store slug the proxy injects.
 */
export const parseStorefrontPath = (path: string): StorefrontPathTarget | null => {
  const [pathname, query = ""] = path.split("?", 2);
  const search = new URLSearchParams(query);

  const product = pathname.match(/^\/product\/([^/]+)\/?$/);
  if (product) return { kind: "product", ref: decodeURIComponent(product[1]), search };

  if (/^\/catalog\/?$/.test(pathname)) {
    const categoryToken = search.get("category");
    if (categoryToken && !isReservedCategoryValue(categoryToken)) {
      return { kind: "catalog", categoryToken, search };
    }
  }

  return null;
};

/** The slug URL of a product reached by id, with the visitor's query kept. */
export const buildProductSlugPath = (slug: string, search: URLSearchParams): string => {
  const query = search.toString();
  return `/product/${slug}${query ? `?${query}` : ""}`;
};

/** The same catalog URL with `?category=` rewritten to the category's slug. */
export const buildCategorySlugPath = (
  category: { id: string; slug?: string | null },
  search: URLSearchParams,
): string => {
  const rest = new URLSearchParams(search);
  rest.delete("category");
  const query = rest.toString();
  return `${buildCategoryBrowseHref(getCategoryToken(category))}${query ? `&${query}` : ""}`;
};

/** Turns a Next `searchParams` object back into query parameters. */
export const toSearchParams = (
  searchParams: Record<string, string | string[] | undefined>,
): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, entry);
    }
  }
  return params;
};
