/**
 * Reserved `?category=` values of the catalog. Kept identical to the ones
 * `category-browse-grid.tsx` exports so both surfaces read one URL contract:
 * `all` = browse everything (explicit choice in categories mode), and
 * `uncategorized` = products linked to no category ("Autres").
 */
export const ALL_CATEGORIES_VALUE = "all";
export const UNCATEGORIZED_CATEGORY_VALUE = "uncategorized";

export const isReservedCategoryValue = (value: string | null | undefined): boolean =>
  value === ALL_CATEGORIES_VALUE || value === UNCATEGORIZED_CATEGORY_VALUE;

/** Cards per server page: six rows of four on desktop, twelve rows of two on a phone. */
export const CATALOG_PAGE_SIZE = 24;

export const CATALOG_SORT_VALUES = ["recommended", "priceAsc", "priceDesc"] as const;
export type CatalogSort = (typeof CATALOG_SORT_VALUES)[number];
export const DEFAULT_CATALOG_SORT: CatalogSort = "recommended";

export const isCatalogSort = (value: string | null | undefined): value is CatalogSort =>
  CATALOG_SORT_VALUES.some((sort) => sort === value);

/** Category tiles only replace the grid once there is something to choose between. */
export const MIN_BROWSABLE_CATEGORIES = 2;
