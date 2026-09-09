"use client";

import { useMemo } from "react";

import { hashKey, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { PageTracker } from "@/components/storefront/page-tracker";
import { ProductGrid } from "@/components/storefront/product/product-grid";
import { ProductGridSkeleton } from "@/components/storefront/product/product-grid-skeleton";
import { useProductCardAvailability } from "@/components/storefront/product/use-product-card-availability";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { useStore } from "@/contexts/store-context";
import { catalogQueries } from "@/lib/queries/catalog.queries";
import { useStorefrontSearch } from "@/contexts/storefront-search-context";
import { storefrontQueries } from "@/lib/queries/storefront.queries";
import { isReservedCategoryValue } from "@/lib/storefront/catalog.constants";
import type {
  CatalogAttributeAxis,
  CatalogCategory,
  CatalogPriceBounds,
  CatalogProductsPage,
} from "@/lib/storefront/catalog.queries";
import {
  CLEAR_CATALOG_FILTERS_PATCH,
  type CatalogFilters,
  countActiveCatalogFilters,
  countAvailableByCategory,
  filterBookableProducts,
  filterCatalogProducts,
  filterProductsByAvailableQuantity,
  getCatalogTitle,
  sortCatalogProducts,
} from "@/lib/utils/util.rental-browse";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

import { CatalogActiveFilters } from "./catalog-active-filters";
import { CatalogEmptyState } from "./catalog-empty-state";
import { CatalogFiltersDrawer } from "./catalog-filters-drawer";
import { CatalogHeader } from "./catalog-header";
import { CatalogSidebar } from "./catalog-sidebar";
import { CatalogSortSelect } from "./catalog-sort-select";
import { useCatalogParams } from "./use-catalog-params";
import { useCatalogPeriod } from "./use-catalog-period";

/** Placeholder input while the query is disabled; never sent. */
const EMPTY_PERIOD = { startDate: "", endDate: "" };

interface CatalogBrowserProps {
  rules: RentalPeriodRules;
  categories: CatalogCategory[];
  uncategorizedCount: number;
  /** Active products linked to no category, to count the available ones. */
  uncategorizedProductIds: string[];
  /** Every active product of the store, for the "all" row. */
  totalCount: number;
  /** The variant axes the store's units carry, for the sidebar. */
  attributeAxes: CatalogAttributeAxis[];
  /** The range the prices span for the browsed period, for the price filter. */
  priceBounds: CatalogPriceBounds;
  /** The filters the server page answers. */
  filters: CatalogFilters;
  initialPage: CatalogProductsPage;
  initialDataUpdatedAt: number;
}

/**
 * The catalog: a filter rail on the left, the product grid on the right.
 * The URL holds the filters; the search query and the period come from the
 * header, which carries them on every route; availability is fetched once
 * dates are known; pages append under "Charger plus".
 */
export const CatalogBrowser = ({
  rules,
  categories,
  uncategorizedCount,
  uncategorizedProductIds,
  totalCount,
  attributeAxes,
  priceBounds: initialPriceBounds,
  filters: serverFilters,
  initialPage,
  initialDataUpdatedAt,
}: CatalogBrowserProps) => {
  const t = useTranslations("storefront");
  const { filters, update } = useCatalogParams();
  const { storeSlug } = useStore();
  const { period } = useCatalogPeriod({ filters, update, pricingMode: rules.pricingMode });
  // The header owns the field; this is the same keystroke, so the loaded grid
  // narrows without waiting for the URL to come back.
  const { draft: search, clear: clearSearch } = useStorefrontSearch();
  const options = catalogQueries.pages(storeSlug, filters);
  const isInitialQuery =
    hashKey(options.queryKey) === hashKey(catalogQueries.pages(storeSlug, serverFilters).queryKey);
  const query = useInfiniteQuery({
    ...options,
    initialData: isInitialQuery
      ? {
          pages: [{ ...initialPage, priceBounds: initialPriceBounds }],
          pageParams: [null],
        }
      : undefined,
    initialDataUpdatedAt,
  });
  const isPending = query.isPending;
  const priceBounds = query.data?.pages[0]?.priceBounds ?? initialPriceBounds;
  const products = useMemo(() => {
    const byId = new Map<string, CatalogProductsPage["products"][number]>();
    for (const page of query.data?.pages ?? []) {
      for (const product of page.products) byId.set(product.id, product);
    }
    return [...byId.values()];
  }, [query.data]);
  const pages = {
    products,
    totalCount: query.data?.pages[0]?.totalCount ?? 0,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (!query.isFetching) void query.fetchNextPage();
    },
  };
  const availabilityByProductId = useProductCardAvailability(pages.products, period);
  // The store-wide answer, for the sidebar's per-category counts; the cards'
  // hook reads the same query, so this costs no extra request.
  const { data: storeAvailability } = useQuery({
    ...storefrontQueries.availability(period ?? EMPTY_PERIOD),
    enabled: period !== null,
  });
  const availableCounts = useMemo(
    () =>
      countAvailableByCategory(
        categories,
        uncategorizedProductIds,
        period && storeAvailability
          ? new Map(
              storeAvailability.products.map((entry) => [entry.productId, entry.availableQuantity]),
            )
          : null,
      ),
    [categories, uncategorizedProductIds, period, storeAvailability],
  );

  const handleShowAll = () => {
    clearSearch();
    update({ ...CLEAR_CATALOG_FILTERS_PATCH, search: null });
  };

  const hidesUnavailable = filters.availableOnly && period !== null;
  const needsQuantity = filters.quantity !== null && period !== null;
  const hasClientFilters = hidesUnavailable || needsQuantity;

  const visibleProducts = useMemo(() => {
    const matching = filterCatalogProducts(pages.products, { ...filters, search });
    const bookable = hidesUnavailable
      ? filterBookableProducts(matching, availabilityByProductId)
      : matching;
    const enough =
      needsQuantity && filters.quantity !== null
        ? filterProductsByAvailableQuantity(bookable, filters.quantity, availabilityByProductId)
        : bookable;
    return sortCatalogProducts(enough, {
      categories,
      availabilityByProductId,
      sort: filters.sort,
    });
  }, [
    pages.products,
    filters,
    search,
    hidesUnavailable,
    needsQuantity,
    categories,
    availabilityByProductId,
  ]);

  const title = getCatalogTitle(filters.category, categories, {
    catalog: t("catalog.title"),
    others: t("availability.categoryBrowse.others"),
  });
  // The server counts what its filters match; availability and the period's
  // quantity are client filters, so once they hide products only the loaded
  // ones can be counted.
  const count = hasClientFilters ? visibleProducts.length : pages.totalCount;
  const trackedCategoryId =
    filters.category && !isReservedCategoryValue(filters.category) ? filters.category : undefined;
  const showCategories = categories.some(
    (category) => category.productCount > 0 && category.productCount < totalCount,
  );
  // Store-wide criteria keep the layout stable while results are filtered.
  const showSidebar = showCategories || attributeAxes.length >= 3;

  const sidebar = (
    <CatalogSidebar
      showCategories={showCategories}
      categories={categories}
      uncategorizedCount={uncategorizedCount}
      totalCount={totalCount}
      availableCounts={availableCounts}
      attributeAxes={attributeAxes}
      priceBounds={priceBounds}
      hasPeriod={period !== null}
      filters={filters}
      update={update}
    />
  );

  return (
    <>
      <PageTracker page="catalog" categoryId={trackedCategoryId} />

      <StorefrontSection spacing="tight" className="pb-8 sm:pb-12">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
          {showSidebar ? (
            <aside className="hidden w-60 shrink-0 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
              {sidebar}
            </aside>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <CatalogHeader title={title} count={count} />
              <div className="flex shrink-0 items-center gap-2">
                <CatalogFiltersDrawer
                  activeCount={countActiveCatalogFilters(filters)}
                  resultCount={count}
                  className={cn("h-11 shrink-0 gap-1.5 px-3 sm:h-9", showSidebar && "lg:hidden")}
                >
                  {sidebar}
                </CatalogFiltersDrawer>
                {totalCount > 1 ? (
                  <CatalogSortSelect value={filters.sort} onChange={(sort) => update({ sort })} />
                ) : null}
              </div>
            </div>
            <CatalogActiveFilters
              filters={filters}
              categories={categories}
              attributeAxes={attributeAxes}
              priceBounds={priceBounds}
              update={update}
            />

            <div
              className={cn(
                "flex flex-col gap-6 motion-safe:transition-opacity motion-safe:duration-200",
                isPending && "opacity-60",
              )}
              aria-busy={isPending || undefined}
            >
              {query.isError ? (
                <div role="alert" className="flex items-center gap-3 rounded-xl border p-4">
                  <p className="text-sm text-muted-foreground">{t("error.title")}</p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
                    }
                  >
                    {t("error.retry")}
                  </Button>
                </div>
              ) : null}
              {visibleProducts.length === 0 ? (
                isPending ? (
                  <ProductGridSkeleton />
                ) : query.isError ? null : (
                  <CatalogEmptyState search={search} onShowAll={handleShowAll} />
                )
              ) : (
                <ProductGrid
                  products={visibleProducts}
                  period={period}
                  availabilityByProductId={availabilityByProductId}
                />
              )}

              {pages.hasMore && !isPending ? (
                <Button
                  variant="outline"
                  onClick={pages.loadMore}
                  disabled={pages.isLoadingMore}
                  className="h-12 w-full self-center lg:h-10 lg:w-auto lg:min-w-48"
                >
                  {t("catalog.loadMore")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </StorefrontSection>
    </>
  );
};
