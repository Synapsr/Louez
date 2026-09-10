"use client";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import type { CatalogAttributeAxis, CatalogPriceBounds } from "@/lib/storefront/catalog.queries";
import {
  type BrowsableCategory,
  CLEAR_CATALOG_FILTERS_PATCH,
  type CatalogFilters,
  type CatalogFiltersPatch,
  type CategoryAvailableCounts,
  countActiveCatalogFilters,
  toggleCatalogAttribute,
} from "@/lib/utils/util.rental-browse";

import { CatalogAttributeFilter } from "./catalog-attribute-filter";
import { CatalogAvailabilityFilter } from "./catalog-availability-filter";
import { CatalogCategoryList } from "./catalog-category-list";
import { CatalogFilterSection } from "./catalog-filter-section";
import { CatalogPriceFilter } from "./catalog-price-filter";
import { CatalogQuantityFilter } from "./catalog-quantity-filter";

interface CatalogSidebarProps {
  showCategories: boolean;
  categories: readonly BrowsableCategory[];
  uncategorizedCount: number;
  /** Every active product of the store, for the "all" row. */
  totalCount: number;
  /** Per-category counts the period can still book; null until dates are known and answered. */
  availableCounts: CategoryAvailableCounts | null;
  /** The variant axes the store's units carry; empty for a store without variants. */
  attributeAxes: readonly CatalogAttributeAxis[];
  /** The range the price filter spans, for the browsed period or the base rates. */
  priceBounds: CatalogPriceBounds;
  hasPeriod: boolean;
  filters: CatalogFilters;
  update: (patch: CatalogFiltersPatch) => void;
  className?: string;
}

/**
 * The filter rail of the catalog: categories, then what the period can
 * book (availability, quantity), then the variant axes, then price. One
 * component for both places it appears — the desktop column and the phone
 * drawer — so the two can never drift apart.
 */
export const CatalogSidebar = ({
  showCategories,
  categories,
  uncategorizedCount,
  totalCount,
  availableCounts,
  attributeAxes,
  priceBounds,
  hasPeriod,
  filters,
  update,
  className,
}: CatalogSidebarProps) => {
  const t = useTranslations("storefront.catalog");
  const activeCount = countActiveCatalogFilters(filters);
  // A store whose products all cost the same has no range to slide over.
  const hasPriceRange = priceBounds.max > priceBounds.min;

  return (
    <div className={cn("flex flex-col gap-5", className)} data-slot="catalog-sidebar">
      {showCategories ? (
        <CatalogFilterSection title={t("categories")}>
          <CatalogCategoryList
            categories={categories}
            uncategorizedCount={uncategorizedCount}
            totalCount={totalCount}
            availableCounts={availableCounts}
            selected={filters.category}
            onSelect={(category) => update({ category })}
          />
        </CatalogFilterSection>
      ) : null}

      <CatalogFilterSection title={t("availability")}>
        <div className="flex flex-col gap-3">
          <CatalogAvailabilityFilter
            checked={!filters.availableOnly}
            onChange={(showUnavailable) => update({ availableOnly: !showUnavailable })}
          />
          <CatalogQuantityFilter
            value={filters.quantity}
            onChange={(quantity) => update({ quantity })}
          />
        </div>
      </CatalogFilterSection>

      {attributeAxes.map((axis) => (
        <CatalogFilterSection key={axis.key} title={axis.label}>
          <CatalogAttributeFilter
            axis={axis}
            selected={filters.attributes[axis.key] ?? []}
            onToggle={(value, selected) =>
              update({
                attributes: toggleCatalogAttribute(filters.attributes, axis.key, value, selected),
              })
            }
          />
        </CatalogFilterSection>
      ))}

      {hasPriceRange ? (
        <CatalogFilterSection title={t("price")}>
          <CatalogPriceFilter
            bounds={priceBounds}
            min={filters.minPrice}
            max={filters.maxPrice}
            hasPeriod={hasPeriod}
            onChange={(range) => update({ minPrice: range.min, maxPrice: range.max })}
          />
        </CatalogFilterSection>
      ) : null}

      {activeCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          className="h-11 self-start px-3 text-sm lg:h-9"
          onClick={() => update(CLEAR_CATALOG_FILTERS_PATCH)}
        >
          {t("clearFilters")}
        </Button>
      ) : null}
    </div>
  );
};
