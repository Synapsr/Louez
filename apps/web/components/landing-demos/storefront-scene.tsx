"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CatalogLayout } from "@/app/(storefront)/[slug]/catalog/catalog-layout";
import { CatalogSidebar } from "@/app/(storefront)/[slug]/catalog/catalog-sidebar";
import { CatalogActiveFilters } from "@/app/(storefront)/[slug]/catalog/catalog-active-filters";
import { CatalogEmptyState } from "@/app/(storefront)/[slug]/catalog/catalog-empty-state";
import { ProductGridView } from "@/components/storefront/product/product-grid-view";
import { CartDrawerView } from "@/components/storefront/cart/cart-drawer-view";
import { CartPanelView } from "@/components/storefront/cart/cart-panel-view";
import { CartTriggerView } from "@/components/storefront/cart/cart-trigger-view";
import { CartEmptyState } from "@/components/storefront/cart/cart-empty-state";
import { StoreHeader } from "@/components/storefront/store-header";
import { HeaderSearchCapsuleView } from "@/components/storefront/shell/header-search-capsule-view";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import {
  DEMO_PRODUCTS,
  DEMO_CATEGORIES,
  DEMO_RULES,
  type DemoBooking,
} from "@/lib/landing-demos/fixtures";
import { getDemoCart } from "@/lib/landing-demos/cart";
import { getStorefrontProductPrice } from "@/lib/utils/util.storefront-product-pricing";
import {
  applyCatalogParams,
  readCatalogFilters,
  filterCatalogProducts,
  sortCatalogProducts,
  getCatalogTitle,
  countActiveCatalogFilters,
  CLEAR_CATALOG_FILTERS_PATCH,
  type CatalogFiltersPatch,
} from "@/lib/utils/util.rental-browse";

export const StorefrontScene = ({
  compact,
  period: initialPeriod,
  onBookingChange,
}: {
  compact: boolean;
  period: RentalPeriodValue;
  onBookingChange: (booking: DemoBooking) => void;
}) => {
  const t = useTranslations("storefront");
  const [period, setPeriod] = useState(initialPeriod);
  const [params, setParams] = useState(() => new URLSearchParams());
  const [search, setSearch] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const filters = readCatalogFilters(params);
  const update = (patch: CatalogFiltersPatch) => {
    if (patch.search !== undefined) setSearch(patch.search ?? "");
    setParams((current) => applyCatalogParams(current, patch));
  };
  const cart = getDemoCart(quantities, period);
  const changeCart = (next: Record<string, number>, nextPeriod = period) => {
    setQuantities(next);
    const nextCart = getDemoCart(next, nextPeriod);
    if (nextCart.booking) onBookingChange(nextCart.booking);
  };
  const changePeriod = (next: RentalPeriodValue) => {
    setPeriod(next);
    changeCart(quantities, next);
  };
  const products = DEMO_PRODUCTS.map((product) => ({
    ...product,
    displayPrice: getStorefrontProductPrice({
      product,
      timezone: "Europe/Paris",
      startDate: cart.period.startDate,
      endDate: cart.period.endDate,
      quantity: 1,
    }).subtotal,
  }));
  const visible = sortCatalogProducts(filterCatalogProducts(products, filters), {
    categories: DEMO_CATEGORIES,
    sort: filters.sort,
  });
  const priceBounds = {
    min: Math.min(...products.map((product) => product.displayPrice)),
    max: Math.max(...products.map((product) => product.displayPrice)),
  };
  const sidebar = (
    <CatalogSidebar
      showCategories
      categories={DEMO_CATEGORIES}
      totalCount={products.length}
      uncategorizedCount={0}
      availableCounts={null}
      attributeAxes={[]}
      priceBounds={priceBounds}
      hasPeriod
      filters={filters}
      update={update}
    />
  );
  return (
    <div
      data-demo-scene="storefront"
      data-demo-catalog={compact ? "compact" : "full"}
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-slot="store-header"] a'))
          event.preventDefault();
      }}
    >
      <StoreHeader
        storeName="Maison du Vélo"
        homeHref="/demos/landing/storefront"
        periodRules={DEMO_RULES}
        searchControl={
          <HeaderSearchCapsuleView
            rules={DEMO_RULES}
            className="w-full"
            query={search}
            period={period}
            onQueryChange={(value) => update({ search: value })}
            onClear={() => update({ search: null })}
            onSubmit={() => update({ search })}
            onPeriodChange={changePeriod}
          />
        }
        cartControl={<CartTriggerView count={cart.summary.count} open={() => setOpen(true)} />}
      />
      <CatalogLayout
        title={getCatalogTitle(filters.category, DEMO_CATEGORIES, {
          catalog: t("catalog.title"),
          others: t("availability.categoryBrowse.others"),
        })}
        count={visible.length}
        totalCount={products.length}
        showSidebar
        sidebar={sidebar}
        activeCount={countActiveCatalogFilters(filters)}
        sort={filters.sort}
        onSortChange={(sort) => update({ sort })}
        activeFilters={
          <CatalogActiveFilters
            filters={filters}
            categories={DEMO_CATEGORIES}
            attributeAxes={[]}
            priceBounds={priceBounds}
            update={update}
          />
        }
      >
        <div
          onClickCapture={(event) => {
            if (event.target instanceof Element && event.target.closest("a"))
              event.preventDefault();
          }}
        >
          {visible.length ? (
            <ProductGridView
              products={visible}
              period={cart.period}
              getProductHref={() => "/demos/landing/storefront"}
              onQuickAdd={(product) => {
                changeCart({ ...quantities, [product.id]: (quantities[product.id] ?? 0) + 1 });
                setOpen(true);
              }}
            />
          ) : (
            <CatalogEmptyState
              search={filters.search}
              onShowAll={() => update(CLEAR_CATALOG_FILTERS_PATCH)}
              period={period}
              onPeriodChange={changePeriod}
              rules={DEMO_RULES}
            />
          )}
        </div>
      </CatalogLayout>
      <CartDrawerView
        isOpen={open}
        setOpen={setOpen}
        close={() => setOpen(false)}
        summary={cart.summary}
        isEmpty={!cart.items.length}
        blockedReasonKey={null}
        checkoutDisabled
        autoFocus={false}
        modal={false}
        emptyState={<CartEmptyState closeOnly onNavigate={() => setOpen(false)} />}
      >
        <CartPanelView
          items={cart.items}
          period={cart.period}
          resolutionStatus="ready"
          onRemove={(id) => changeCart({ ...quantities, [id]: 0 })}
          onQuantityChange={(id, quantity) => changeCart({ ...quantities, [id]: quantity })}
          onNavigate={(event) => event.preventDefault()}
          getProductHref={() => "/demos/landing/storefront"}
        />
      </CartDrawerView>
    </div>
  );
};
