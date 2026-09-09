import type { AvailabilityStatus } from "@/components/storefront/availability-badge";
import {
  ALL_CATEGORIES_VALUE,
  type CatalogSort,
  DEFAULT_CATALOG_SORT,
  UNCATEGORIZED_CATEGORY_VALUE,
  isCatalogSort,
  isReservedCategoryValue,
} from "@/lib/storefront/catalog.constants";

/** The slice of a catalog product the browse rules read. */
export interface BrowsableCatalogProduct {
  id: string;
  name: string;
  description?: string | null;
  price: string | number;
  /**
   * The price the card prints — the period total once dates are known, the
   * base rate before. The server computes it; the base price stands in
   * when it is absent.
   */
  displayPrice?: number;
  /** Units in the fleet; `null` when stock is not tracked (never runs out). */
  quantity?: number | null;
  /** Values the product's bookable units carry, per axis key. */
  attributeValues?: Readonly<Record<string, readonly string[]>>;
  /** Every category the product is linked to; empty = "Autres". */
  categoryIds: readonly string[];
}

/** Selected values per axis key; an axis absent from the record is not filtered. */
export type CatalogAttributeFilters = Readonly<Record<string, readonly string[]>>;

export interface BrowsableCategory {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  order?: number | null;
  /** Active products linked to the category. */
  productCount: number;
}

/** The catalog URL, parsed. `category` is a real id, a reserved value or null. */
export interface CatalogFilters {
  category: string | null;
  search: string;
  startDate: string | null;
  endDate: string | null;
  sort: CatalogSort;
  /** Lower bound of the price filter, in the store currency; null = no bound. */
  minPrice: number | null;
  maxPrice: number | null;
  /** Hides what the browsed period cannot book; means nothing without dates. */
  availableOnly: boolean;
  /** Units the visitor needs at once; null (or one) means no filter. */
  quantity: number | null;
  /** Variant values the visitor picked, per axis key. */
  attributes: CatalogAttributeFilters;
}

export type CatalogFiltersPatch = Partial<{
  category: string | null;
  search: string | null;
  startDate: string | null;
  endDate: string | null;
  sort: CatalogSort | null;
  minPrice: number | null;
  maxPrice: number | null;
  availableOnly: boolean | null;
  quantity: number | null;
  attributes: CatalogAttributeFilters | null;
}>;

/** The `availableOnly` flag as it appears in the URL. */
const AVAILABLE_ONLY_PARAM_VALUE = "1";

/** One `attr=` entry per picked value: `attr=size:M&attr=size:L&attr=color:red`. */
const ATTRIBUTE_PARAM = "attr";
const ATTRIBUTE_PARAM_SEPARATOR = ":";

/** A quantity from the URL: a whole number of two or more, or nothing. */
const readQuantityParam = (raw: string | null): number | null => {
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 2 ? parsed : null;
};

/** `attr=` entries as a record; a malformed entry is skipped, a repeated value counted once. */
export const readAttributeParams = (entries: readonly string[]): CatalogAttributeFilters => {
  const byAxis: Record<string, string[]> = {};
  for (const entry of entries) {
    const separator = entry.indexOf(ATTRIBUTE_PARAM_SEPARATOR);
    if (separator <= 0) continue;
    const axis = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (!axis || !value) continue;
    const values = (byAxis[axis] ??= []);
    if (!values.includes(value)) values.push(value);
  }
  return byAxis;
};

/** A price bound from the URL: a finite, non-negative number, or nothing. */
const readPriceParam = (raw: string | null): number | null => {
  if (raw === null) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/** Reads the browse filters from a query string; unknown values fall back to defaults. */
export const readCatalogFilters = (params: URLSearchParams): CatalogFilters => {
  const sort = params.get("sort");
  const minPrice = readPriceParam(params.get("minPrice"));
  const maxPrice = readPriceParam(params.get("maxPrice"));
  // An inverted range would match nothing; read it as "no price filter".
  const isInverted = minPrice !== null && maxPrice !== null && minPrice > maxPrice;

  return {
    category: params.get("category") || null,
    search: params.get("search")?.trim() ?? "",
    startDate: params.get("startDate") || null,
    endDate: params.get("endDate") || null,
    sort: isCatalogSort(sort) ? sort : DEFAULT_CATALOG_SORT,
    minPrice: isInverted ? null : minPrice,
    maxPrice: isInverted ? null : maxPrice,
    availableOnly: params.get("availableOnly") === AVAILABLE_ONLY_PARAM_VALUE,
    quantity: readQuantityParam(params.get("quantity")),
    attributes: readAttributeParams(params.getAll(ATTRIBUTE_PARAM)),
  };
};

/** The query value of a patch entry, or null when the key belongs out of the URL. */
const serializeCatalogParam = (
  key: keyof CatalogFiltersPatch,
  value: string | number | boolean,
): string | null => {
  if (key === "availableOnly") {
    return value === true ? AVAILABLE_ONLY_PARAM_VALUE : null;
  }
  if (key === "minPrice" || key === "maxPrice") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? String(value) : null;
  }
  if (key === "quantity") {
    return typeof value === "number" && Number.isInteger(value) && value >= 2
      ? String(value)
      : null;
  }
  if (typeof value !== "string") return null;
  if (key === "sort") return value === DEFAULT_CATALOG_SORT ? null : value;
  if (key === "search") return value.trim() || null;
  return value || null;
};

/**
 * Applies a patch to the current query string. `null` removes a key, and so
 * does any value that is already the default — the plain catalog keeps its
 * clean address.
 */
export const applyCatalogParams = (
  current: URLSearchParams,
  patch: CatalogFiltersPatch,
): URLSearchParams => {
  const next = new URLSearchParams(current);
  const { attributes, ...scalars } = patch;

  if (attributes !== undefined) {
    next.delete(ATTRIBUTE_PARAM);
    for (const [axis, values] of Object.entries(attributes ?? {})) {
      for (const value of values) {
        next.append(ATTRIBUTE_PARAM, `${axis}${ATTRIBUTE_PARAM_SEPARATOR}${value}`);
      }
    }
  }

  const entries = Object.entries(scalars) as [
    keyof CatalogFiltersPatch,
    string | number | boolean | null | undefined,
  ][];

  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const serialized = value === null ? null : serializeCatalogParam(key, value);
    if (serialized === null) {
      next.delete(key);
    } else {
      next.set(key, serialized);
    }
  }

  return next;
};

export const buildCatalogHref = (params: URLSearchParams): string => {
  const query = params.toString();
  return query ? `/catalog?${query}` : "/catalog";
};

const normalize = (value: string): string => value.trim().toLowerCase();

const toPrice = (value: string | number): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** The price the browse rules compare: what the card prints, else the base price. */
export const getBrowsePrice = (
  product: Pick<BrowsableCatalogProduct, "price" | "displayPrice">,
): number => product.displayPrice ?? toPrice(product.price);

export const matchesCatalogSearch = (
  product: Pick<BrowsableCatalogProduct, "name" | "description">,
  search: string,
): boolean => {
  const term = normalize(search);
  if (!term) return true;
  return (
    normalize(product.name).includes(term) ||
    (product.description ? normalize(product.description).includes(term) : false)
  );
};

export const matchesCatalogCategory = (
  product: Pick<BrowsableCatalogProduct, "categoryIds">,
  category: string | null,
): boolean => {
  if (!category || category === ALL_CATEGORIES_VALUE) return true;
  if (category === UNCATEGORIZED_CATEGORY_VALUE) return product.categoryIds.length === 0;
  return product.categoryIds.includes(category);
};

/** Both bounds are inclusive; a missing bound is an open end. */
export const matchesCatalogPrice = (
  product: Pick<BrowsableCatalogProduct, "price" | "displayPrice">,
  { minPrice, maxPrice }: Pick<CatalogFilters, "minPrice" | "maxPrice">,
): boolean => {
  const price = getBrowsePrice(product);
  return (minPrice === null || price >= minPrice) && (maxPrice === null || price <= maxPrice);
};

/**
 * Every picked axis must be met by one value the product's units carry.
 * A product without units for an axis cannot meet it.
 */
export const matchesCatalogAttributes = (
  product: Pick<BrowsableCatalogProduct, "attributeValues">,
  attributes: CatalogAttributeFilters,
): boolean =>
  Object.entries(attributes).every(([axis, wanted]) => {
    if (wanted.length === 0) return true;
    const carried = product.attributeValues?.[axis] ?? [];
    return wanted.some((value) => carried.includes(value));
  });

/** The fleet holds that many units; untracked stock never runs out. */
export const matchesCatalogStock = (
  product: Pick<BrowsableCatalogProduct, "quantity">,
  quantity: number | null,
): boolean =>
  quantity === null || product.quantity === null || product.quantity === undefined
    ? true
    : product.quantity >= quantity;

/** The filters the client can answer on its own, without server availability. */
export type StaticCatalogFilters = Pick<
  CatalogFilters,
  "category" | "search" | "minPrice" | "maxPrice" | "quantity" | "attributes"
>;

/**
 * Client-side mirror of the server filter, applied to the products already
 * on screen so a category tap answers before the server page streams in.
 */
export const filterCatalogProducts = <T extends BrowsableCatalogProduct>(
  products: readonly T[],
  filters: StaticCatalogFilters,
): T[] =>
  products.filter(
    (product) =>
      matchesCatalogCategory(product, filters.category) &&
      matchesCatalogSearch(product, filters.search) &&
      matchesCatalogPrice(product, filters) &&
      matchesCatalogStock(product, filters.quantity) &&
      matchesCatalogAttributes(product, filters.attributes),
  );

/** Statuses a visitor can still add to the cart for the browsed period. */
const BOOKABLE_STATUSES: ReadonlySet<AvailabilityStatus> = new Set<AvailabilityStatus>([
  "available",
  "in_cart",
  "limited",
]);

/**
 * Keeps only what the browsed period can book. Availability is a client
 * query, so unknown never means unavailable: an empty map is "not answered
 * yet" (otherwise the grid would blank out on every date change), and a
 * product the answer skipped stays in, like a card falling back to stock.
 */
export const filterBookableProducts = <T extends BrowsableCatalogProduct>(
  products: readonly T[],
  availabilityByProductId: ReadonlyMap<string, { status: AvailabilityStatus }>,
): T[] => {
  if (availabilityByProductId.size === 0) return [...products];
  return products.filter((product) => {
    const status = availabilityByProductId.get(product.id)?.status;
    return status === undefined || BOOKABLE_STATUSES.has(status);
  });
};

/**
 * Keeps what the browsed period can book that many of. Same reading of the
 * map as `filterBookableProducts`: unknown never means unavailable, and a
 * `null` quantity is untracked stock.
 */
export const filterProductsByAvailableQuantity = <T extends BrowsableCatalogProduct>(
  products: readonly T[],
  quantity: number,
  availabilityByProductId: ReadonlyMap<string, { availableQuantity: number | null }>,
): T[] => {
  if (availabilityByProductId.size === 0) return [...products];
  return products.filter((product) => {
    const available = availabilityByProductId.get(product.id)?.availableQuantity;
    return available === undefined || available === null || available >= quantity;
  });
};

/** How many products of each category the period can still book. */
export interface CategoryAvailableCounts {
  byCategoryId: ReadonlyMap<string, number>;
  uncategorized: number;
  total: number;
}

/**
 * Available product counts per category, from the store-wide availability
 * answer. `null` until it arrives, so the sidebar keeps showing plain totals
 * rather than a row of zeros.
 */
export const countAvailableByCategory = (
  categories: readonly { id: string; productIds: readonly string[] }[],
  uncategorizedProductIds: readonly string[],
  availableQuantityByProductId: ReadonlyMap<string, number | null> | null,
): CategoryAvailableCounts | null => {
  if (availableQuantityByProductId === null) return null;
  const isAvailable = (id: string): boolean => {
    const available = availableQuantityByProductId.get(id);
    return available === undefined || available === null || available > 0;
  };
  const countOf = (ids: readonly string[]): number => ids.filter(isAvailable).length;

  const byCategoryId = new Map(categories.map((c) => [c.id, countOf(c.productIds)]));
  const uncategorized = countOf(uncategorizedProductIds);
  const seen = new Set<string>();
  let total = 0;
  for (const id of [...categories.flatMap((c) => c.productIds), ...uncategorizedProductIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (isAvailable(id)) total += 1;
  }
  return { byCategoryId, uncategorized, total };
};

/**
 * Filters the visitor has actually set, for the badge on the mobile
 * "Filtres" button. Search and dates live in the toolbar, in plain sight,
 * so they are not counted; the price range counts once whichever bound is
 * set.
 */
export const countActiveCatalogFilters = ({
  category,
  minPrice,
  maxPrice,
  availableOnly,
  quantity,
  attributes,
}: Pick<
  CatalogFilters,
  "category" | "minPrice" | "maxPrice" | "availableOnly" | "quantity" | "attributes"
>): number => {
  let count = 0;
  if (category !== null && category !== ALL_CATEGORIES_VALUE) count += 1;
  if (minPrice !== null || maxPrice !== null) count += 1;
  if (availableOnly) count += 1;
  if (quantity !== null) count += 1;
  count += Object.values(attributes).filter((values) => values.length > 0).length;
  return count;
};

/** Everything the sidebar sets, back to its default: the patch behind "Effacer les filtres". */
export const CLEAR_CATALOG_FILTERS_PATCH: CatalogFiltersPatch = {
  category: null,
  minPrice: null,
  maxPrice: null,
  availableOnly: false,
  quantity: null,
  attributes: null,
};

/** The attribute record with one value toggled; an axis left empty is dropped. */
export const toggleCatalogAttribute = (
  attributes: CatalogAttributeFilters,
  axis: string,
  value: string,
  selected: boolean,
): CatalogAttributeFilters => {
  const current = attributes[axis] ?? [];
  const next = selected
    ? current.includes(value)
      ? current
      : [...current, value]
    : current.filter((entry) => entry !== value);
  const { [axis]: _dropped, ...rest } = attributes;
  return next.length > 0 ? { ...rest, [axis]: next } : rest;
};

const AVAILABILITY_RANK: Record<AvailabilityStatus, number> = {
  available: 0,
  in_cart: 0,
  limited: 1,
  unavailable: 2,
  out_of_stock: 2,
  required_accessory_out_of_stock: 2,
};

const UNCATEGORIZED_ORDER = Number.MAX_SAFE_INTEGER;

export interface SortCatalogProductsOptions {
  categories: readonly Pick<BrowsableCategory, "id" | "order">[];
  /** Server availability for the browsed period; absent = everything bookable. */
  availabilityByProductId?: ReadonlyMap<string, { status: AvailabilityStatus }>;
  sort?: CatalogSort;
}

/**
 * `recommended` keeps the merchant's catalog order: category order first,
 * then bookable products before unavailable ones, then `displayOrder` (the
 * order the server returned). Price sorts ignore categories and keep the
 * server order between equal prices.
 */
export const sortCatalogProducts = <T extends BrowsableCatalogProduct>(
  products: readonly T[],
  { categories, availabilityByProductId, sort = DEFAULT_CATALOG_SORT }: SortCatalogProductsOptions,
): T[] => {
  const indexById = new Map(products.map((product, index) => [product.id, index]));
  const byServerOrder = (a: T, b: T) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);

  if (sort === "priceAsc" || sort === "priceDesc") {
    const direction = sort === "priceAsc" ? 1 : -1;
    return [...products].sort(
      (a, b) => direction * (getBrowsePrice(a) - getBrowsePrice(b)) || byServerOrder(a, b),
    );
  }

  const categoryOrderById = new Map(
    categories.map((category, index) => [category.id, category.order ?? index]),
  );
  const categoryOrderOf = (product: T): number => {
    const orders = product.categoryIds
      .map((id) => categoryOrderById.get(id))
      .filter((order): order is number => order !== undefined);
    return orders.length > 0 ? Math.min(...orders) : UNCATEGORIZED_ORDER;
  };
  const availabilityRankOf = (product: T): number =>
    AVAILABILITY_RANK[availabilityByProductId?.get(product.id)?.status ?? "available"];

  return [...products].sort(
    (a, b) =>
      categoryOrderOf(a) - categoryOrderOf(b) ||
      availabilityRankOf(a) - availabilityRankOf(b) ||
      byServerOrder(a, b),
  );
};

export interface CategoryBuckets<T> {
  byCategoryId: Map<string, T[]>;
  uncategorized: T[];
}

/** Groups products by category; a multi-category product lands in each bucket. */
export const bucketProductsByCategory = <T extends BrowsableCatalogProduct>(
  products: readonly T[],
): CategoryBuckets<T> => {
  const byCategoryId = new Map<string, T[]>();
  const uncategorized: T[] = [];

  for (const product of products) {
    if (product.categoryIds.length === 0) {
      uncategorized.push(product);
      continue;
    }
    for (const categoryId of product.categoryIds) {
      const bucket = byCategoryId.get(categoryId);
      if (bucket) bucket.push(product);
      else byCategoryId.set(categoryId, [product]);
    }
  }

  return { byCategoryId, uncategorized };
};

/** The heading of the catalog for a category param: a category name, "Autres", or the default. */
export const getCatalogTitle = (
  category: string | null,
  categories: readonly Pick<BrowsableCategory, "id" | "name">[],
  labels: { catalog: string; others: string },
): string => {
  if (category === UNCATEGORIZED_CATEGORY_VALUE) return labels.others;
  if (!category || isReservedCategoryValue(category)) return labels.catalog;
  return categories.find((entry) => entry.id === category)?.name ?? labels.catalog;
};
