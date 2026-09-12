import "server-only";

import { cache } from "react";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  categories,
  db,
  getEffectiveProductQuantities,
  productCategories,
  products,
} from "@louez/db";
import type { ReviewBoosterSettings, StoreSettings, StoreTheme } from "@louez/types";
import type { StockQuantityLimit } from "@louez/utils";

import type { CategoryBrowseEntry } from "@/components/storefront/category-browse-grid";
import { getCachedPlaceDetails } from "@/lib/google-places/cache";
import type { PlaceDetails } from "@/lib/google-places";
import { mergeCurrentPlaceDetails } from "@/lib/google-places/util.place-summary";
import { getStoreBySlug, type StorefrontStore } from "@/lib/storefront/get-store-by-slug";
import type { AccessoryLink, StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import {
  buildCategoryBrowseEntries,
  type CategoryBrowseLabels,
} from "@/lib/utils/util.category-browse-entries";
import { getStoreReassurance, type StoreReassuranceKey } from "@/lib/utils/util.store-reassurance";
import { getStoreStatus, type StoreStatus } from "@/lib/utils/util.store-status";

/** Two rows of four on desktop, four rows of two on a phone. */
const FEATURED_PRODUCTS_LIMIT = 8;

/** Mirrors the column defaults in `packages/db` for a row saved without settings. */
const DEFAULT_STORE_SETTINGS: StoreSettings = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 1440,
  turnoverBufferMinutes: 0,
};

const DEFAULT_STORE_THEME: StoreTheme = { mode: "light", primaryColor: "#0066FF" };

export type HomeInventory =
  | { kind: "categories"; entries: CategoryBrowseEntry[] }
  | { kind: "products"; products: StorefrontCatalogProduct[] };

export interface HomePlaceSummary {
  /** Google place details when reviews are configured; drives the reviews section. */
  details: PlaceDetails | null;
  rating: number | null;
  reviewCount: number | null;
  showReviews: boolean;
}

export interface HomePageData {
  store: StorefrontStore;
  settings: StoreSettings;
  theme: StoreTheme;
  heroImages: string[];
  /** Editor HTML from the dashboard, rendered as written under the hero title. */
  description: string | null;
  status: StoreStatus | null;
  inventory: HomeInventory;
  reassurance: StoreReassuranceKey[];
  place: HomePlaceSummary;
}

const toNumber = (value: unknown): number | null => {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const readFeaturedProductRows = cache(async (storeId: string) => {
  // Ids first (a light ORDER BY), then the rows: the wide product row with
  // its JSON columns overflows the sort buffer when ordered directly.
  const ids = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.status, "active")))
    .orderBy(asc(products.displayOrder), desc(products.createdAt))
    .limit(FEATURED_PRODUCTS_LIMIT);
  if (ids.length === 0) return [];

  const rows = await db.query.products.findMany({
    where: inArray(
      products.id,
      ids.map((row) => row.id),
    ),
    with: {
      pricingTiers: true,
      category: true,
      accessories: {
        with: { accessory: { with: { pricingTiers: true } } },
      },
    },
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));

  return ids.flatMap(({ id }) => {
    const row = rowById.get(id);
    return row ? [row] : [];
  });
});

type FeaturedProductRow = Awaited<ReturnType<typeof readFeaturedProductRows>>[number];
type FeaturedAccessoryRow = FeaturedProductRow["accessories"][number] & {
  accessory: NonNullable<FeaturedProductRow["accessories"][number]["accessory"]>;
};

interface StockSource {
  id: string;
  quantity: number;
  stockKind: FeaturedProductRow["stockKind"];
  trackUnits: boolean | null;
}

const stockOf = (
  item: StockSource,
  effectiveQuantities: ReadonlyMap<string, number>,
): StockQuantityLimit =>
  item.stockKind === "untracked"
    ? null
    : item.trackUnits
      ? (effectiveQuantities.get(item.id) ?? 0)
      : item.quantity;

/**
 * The first products of the catalog as the card grid reads them. Accessory
 * links come along so the card's quick add respects required accessories
 * once the visitor has a period.
 */
export const getFeaturedProducts = async (storeId: string): Promise<StorefrontCatalogProduct[]> => {
  const rows = await readFeaturedProductRows(storeId);
  if (rows.length === 0) return [];

  const accessoryRowsByProduct = new Map(
    rows.map((row) => [
      row.id,
      row.accessories.filter(
        (link): link is FeaturedAccessoryRow =>
          Boolean(link.accessory) && link.accessory.status === "active",
      ),
    ]),
  );
  const effectiveQuantities = await getEffectiveProductQuantities(db, [
    ...rows.map((row) => row.id),
    ...[...accessoryRowsByProduct.values()].flat().map((link) => link.accessory.id),
  ]);

  return rows.map((row) => {
    const accessories: AccessoryLink[] = (accessoryRowsByProduct.get(row.id) ?? []).map((link) => ({
      id: link.accessory.id,
      name: link.accessory.name,
      price: link.accessory.price,
      deposit: link.accessory.deposit ?? "0",
      images: link.accessory.images,
      quantity: stockOf(link.accessory, effectiveQuantities),
      required: link.required,
      requiredQuantity: link.quantity,
      pricingKind: link.accessory.pricingKind,
      pricingMode: link.accessory.pricingMode,
      basePeriodMinutes: link.accessory.basePeriodMinutes,
      pricingTiers: link.accessory.pricingTiers,
    }));

    return {
      id: row.id,
      name: row.name,
      images: row.images,
      price: row.price,
      deposit: row.deposit,
      quantity: stockOf(row, effectiveQuantities),
      stockKind: row.stockKind,
      pricingKind: row.pricingKind,
      pricingMode: row.pricingMode,
      basePeriodMinutes: row.basePeriodMinutes,
      enforceStrictTiers: row.enforceStrictTiers,
      pricingTiers: row.pricingTiers,
      category: row.category ? { id: row.category.id, name: row.category.name } : null,
      trackUnits: row.trackUnits,
      bookingAttributeAxes: row.bookingAttributeAxes,
      accessories,
    };
  });
};

/**
 * Category tiles for the "categories" browse mode, or an empty list when the
 * store has fewer than two populated categories (the grid takes over).
 */
export const getCategoryBrowseEntries = async (
  storeId: string,
  labels: CategoryBrowseLabels,
): Promise<CategoryBrowseEntry[]> => {
  const [storeCategories, productLinks] = await Promise.all([
    db.query.categories.findMany({
      columns: { id: true, name: true, description: true, imageUrl: true },
      where: eq(categories.storeId, storeId),
      orderBy: [categories.order],
    }),
    db
      .select({
        productId: products.id,
        images: products.images,
        categoryId: productCategories.categoryId,
      })
      .from(products)
      .leftJoin(productCategories, eq(productCategories.productId, products.id))
      .where(and(eq(products.storeId, storeId), eq(products.status, "active")))
      .orderBy(asc(products.displayOrder), desc(products.createdAt)),
  ]);

  return buildCategoryBrowseEntries({ categories: storeCategories, productLinks, labels });
};

/**
 * Google rating and reviews of the store, read once per request: the hero
 * pill, the reviews section and the JSON-LD share it. Details only load
 * when a place is configured; the section itself needs the display flag.
 */
export const getStorePlaceSummary = cache(
  async (configured: ReviewBoosterSettings | null): Promise<HomePlaceSummary> => {
    const placeId = configured?.googlePlaceId;
    const details = placeId ? await getCachedPlaceDetails(placeId) : null;
    const merged = mergeCurrentPlaceDetails(configured, details);

    return {
      details,
      rating: toNumber(merged?.googleRating),
      reviewCount: toNumber(merged?.googleReviewCount),
      showReviews: Boolean(configured?.displayReviewsOnStorefront && placeId && details),
    };
  },
);

const loadInventory = async (
  storeId: string,
  theme: StoreTheme,
  labels: CategoryBrowseLabels,
): Promise<HomeInventory> => {
  if (theme.catalogBrowseMode === "categories") {
    const entries = await getCategoryBrowseEntries(storeId, labels);
    if (entries.length > 0) return { kind: "categories", entries };
  }

  return { kind: "products", products: await getFeaturedProducts(storeId) };
};

/**
 * Everything the home page renders, in one pass. Returns `null` for an
 * unknown store so the page can answer 404. `labels` are the translated
 * names of the reserved category tiles.
 */
export const loadHomePage = async (
  slug: string,
  labels: CategoryBrowseLabels,
): Promise<HomePageData | null> => {
  const store = await getStoreBySlug(slug);
  if (!store) return null;

  const settings = store.settings ?? DEFAULT_STORE_SETTINGS;
  const theme = store.theme ?? DEFAULT_STORE_THEME;

  const [inventory, place] = await Promise.all([
    loadInventory(store.id, theme, labels),
    getStorePlaceSummary(store.reviewBoosterSettings ?? null),
  ]);

  return {
    store,
    settings,
    theme,
    heroImages: theme.heroImages ?? [],
    description: store.description,
    status: getStoreStatus(settings.businessHours, settings.timezone),
    inventory,
    reassurance: getStoreReassurance({
      settings,
      stripeAccountId: store.stripeAccountId,
      stripeChargesEnabled: store.stripeChargesEnabled,
    }),
    place,
  };
};
