import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getTranslations } from "next-intl/server";

import {
  UNCATEGORIZED_CATEGORY_VALUE,
  isReservedCategoryValue,
} from "@/lib/storefront/catalog.constants";
import {
  loadCatalogAttributeAxes,
  loadCatalogCategories,
  loadCatalogPriceIndex,
  loadCatalogProducts,
  parseCatalogSearchParams,
} from "@/lib/storefront/catalog.queries";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import {
  JsonLd,
  generateBreadcrumbSchema,
  generateItemListSchema,
  generateStoreMetadata,
  getCanonicalUrl,
} from "@/lib/seo";
import { getMaxRentalMinutes, getMinRentalMinutes } from "@/lib/utils/rental-duration";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

import { CatalogBrowser } from "./catalog-browser";

interface CatalogPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Keep public browse pages in the router cache for five minutes.
export const unstable_dynamicStaleTime = 300;

/** The category behind `?category=`, or null for the whole catalog and the reserved values. */
const findRealCategory = <T extends { id: string }>(
  category: string | null,
  categories: readonly T[],
): T | null =>
  category && !isReservedCategoryValue(category)
    ? (categories.find((entry) => entry.id === category) ?? null)
    : null;

export async function generateMetadata({
  params,
  searchParams,
}: CatalogPageProps): Promise<Metadata> {
  const { slug } = await params;
  const filters = parseCatalogSearchParams(await searchParams);
  const [store, t, tMeta, tBrowse] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.catalog"),
    getTranslations("storefront.meta"),
    getTranslations("storefront.availability.categoryBrowse"),
  ]);

  if (!store) {
    return { title: tMeta("storeNotFound") };
  }

  const { categories } = await loadCatalogCategories(store.id);
  const category = findRealCategory(filters.category, categories);
  const categoryName =
    category?.name ??
    (filters.category === UNCATEGORIZED_CATEGORY_VALUE ? tBrowse("others") : null);
  const categoryPath = category
    ? `/catalog?category=${encodeURIComponent(category.id)}`
    : filters.category === UNCATEGORIZED_CATEGORY_VALUE
      ? `/catalog?category=${UNCATEGORIZED_CATEGORY_VALUE}`
      : "/catalog";

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      description: store.description,
      logoUrl: store.logoUrl,
      settings: store.settings,
      theme: store.theme,
    },
    {
      title: categoryName
        ? t("metaCategoryTitle", { category: categoryName, storeName: store.name })
        : t("metaTitle", { storeName: store.name }),
      description: categoryName
        ? t("metaCategoryDescription", { category: categoryName, storeName: store.name })
        : t("metaDescription", { storeName: store.name }),
      path: categoryPath,
      // Dated, searched and filtered views are result pages, not landing pages.
      noIndex:
        filters.startDate !== null ||
        filters.search !== "" ||
        filters.minPrice !== null ||
        filters.maxPrice !== null ||
        filters.availableOnly ||
        filters.quantity !== null ||
        Object.keys(filters.attributes).length > 0,
    },
  );
}

export default async function CatalogPage({ params, searchParams }: CatalogPageProps) {
  const { slug } = await params;
  const filters = parseCatalogSearchParams(await searchParams);
  const store = await getStoreBySlug(slug);

  if (!store) {
    notFound();
  }

  const settings = store.settings ?? null;

  const [t, tBrowse, summary, page, priceIndex, attributeAxes] = await Promise.all([
    getTranslations("storefront.catalog"),
    getTranslations("storefront.availability.categoryBrowse"),
    loadCatalogCategories(store.id),
    loadCatalogProducts({
      storeId: store.id,
      category: filters.category,
      search: filters.search,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      quantity: filters.quantity,
      attributes: filters.attributes,
      startDate: filters.startDate,
      endDate: filters.endDate,
      sort: filters.sort,
    }),
    loadCatalogPriceIndex(store.id, filters.startDate, filters.endDate),
    loadCatalogAttributeAxes(store.id),
  ]);

  const rules: RentalPeriodRules = {
    pricingMode: "day",
    businessHours: settings?.businessHours,
    timezone: settings?.timezone,
    advanceNoticeMinutes: settings?.advanceNoticeMinutes ?? 0,
    minRentalMinutes: getMinRentalMinutes(settings),
    maxRentalMinutes: getMaxRentalMinutes(settings),
  };

  const category = findRealCategory(filters.category, summary.categories);
  const listTitle =
    category?.name ??
    (filters.category === UNCATEGORIZED_CATEGORY_VALUE ? tBrowse("others") : t("title"));

  const storeForSchema = { id: store.id, name: store.name, slug: store.slug, settings };
  const breadcrumbItems = [
    { name: store.name, url: getCanonicalUrl(slug) },
    { name: t("title"), url: getCanonicalUrl(slug, "/catalog") },
  ];
  if (listTitle !== t("title")) {
    breadcrumbItems.push({
      name: listTitle,
      url: getCanonicalUrl(slug, `/catalog?category=${encodeURIComponent(filters.category ?? "")}`),
    });
  }

  // Only the server-rendered first page is described; appended pages are not crawled.
  const productsForSchema = page.products.map((product) => ({
    id: product.id,
    name: product.name,
    price: product.price,
    images: product.images,
    quantity: product.quantity ?? 1,
    pricingKind: product.pricingKind,
    pricingMode: product.pricingMode,
    basePeriodMinutes: product.basePeriodMinutes,
  }));

  return (
    <>
      <JsonLd
        data={[
          generateBreadcrumbSchema(storeForSchema, breadcrumbItems),
          ...(productsForSchema.length > 0
            ? [
                generateItemListSchema(
                  storeForSchema,
                  productsForSchema,
                  `${listTitle} - ${store.name}`,
                ),
              ]
            : []),
        ]}
      />
      <CatalogBrowser
        rules={rules}
        categories={summary.categories}
        uncategorizedCount={summary.uncategorizedCount}
        uncategorizedProductIds={summary.uncategorizedProductIds}
        totalCount={summary.totalCount}
        attributeAxes={attributeAxes}
        priceBounds={priceIndex.bounds}
        filters={filters}
        initialPage={page}
        initialDataUpdatedAt={Date.now()}
      />
    </>
  );
}
