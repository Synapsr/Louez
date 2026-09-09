"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { useFormatMoney } from "@/hooks/use-format-money";
import type { CatalogAttributeAxis, CatalogPriceBounds } from "@/lib/storefront/catalog.queries";
import {
  type BrowsableCategory,
  type CatalogFilters,
  type CatalogFiltersPatch,
  getCatalogTitle,
  toggleCatalogAttribute,
} from "@/lib/utils/util.rental-browse";

interface CatalogActiveFiltersProps {
  filters: CatalogFilters;
  categories: readonly BrowsableCategory[];
  /** Names the axes of the attribute chips. */
  attributeAxes: readonly CatalogAttributeAxis[];
  /** Open ends read as the store's own range rather than "no limit". */
  priceBounds: CatalogPriceBounds;
  update: (patch: CatalogFiltersPatch) => void;
  className?: string;
}

interface ActiveFilterChip {
  key: string;
  label: string;
  patch: CatalogFiltersPatch;
}

/**
 * What is currently narrowing the grid, each chip removing its own filter.
 * On a phone the sidebar is behind a button, so this row is the only place
 * the active filters are visible.
 */
export const CatalogActiveFilters = ({
  filters,
  categories,
  attributeAxes,
  priceBounds,
  update,
  className,
}: CatalogActiveFiltersProps) => {
  const t = useTranslations("storefront");
  const formatMoney = useFormatMoney();
  const formatWhole = (amount: number) => formatMoney(amount, { fractionDigits: 0 });

  const categoryLabel = getCatalogTitle(filters.category, categories, {
    catalog: "",
    others: t("availability.categoryBrowse.others"),
  });
  const axisLabelByKey = new Map(attributeAxes.map((axis) => [axis.key, axis.label]));

  const chips: ActiveFilterChip[] = [
    ...(categoryLabel
      ? [{ key: "category", label: categoryLabel, patch: { category: null } }]
      : []),
    ...(filters.availableOnly
      ? [
          {
            key: "availableOnly",
            label: t("catalog.availableOnly"),
            patch: { availableOnly: false },
          },
        ]
      : []),
    ...(filters.quantity !== null
      ? [
          {
            key: "quantity",
            label: t("catalog.quantityChip", { count: filters.quantity }),
            patch: { quantity: null },
          },
        ]
      : []),
    ...Object.entries(filters.attributes).flatMap(([axis, values]) =>
      values.map((value) => ({
        key: `attr:${axis}:${value}`,
        label: t("catalog.attributeChip", { axis: axisLabelByKey.get(axis) ?? axis, value }),
        patch: { attributes: toggleCatalogAttribute(filters.attributes, axis, value, false) },
      })),
    ),
    ...(filters.minPrice !== null || filters.maxPrice !== null
      ? [
          {
            key: "price",
            label: t("catalog.priceRange", {
              min: formatWhole(filters.minPrice ?? priceBounds.min),
              max: formatWhole(filters.maxPrice ?? priceBounds.max),
            }),
            patch: { minPrice: null, maxPrice: null },
          },
        ]
      : []),
  ];

  if (chips.length === 0) return null;

  return (
    <ul
      aria-label={t("catalog.activeFilters")}
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-slot="catalog-active-filters"
    >
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            onClick={() => update(chip.patch)}
            className="inline-flex items-center gap-1.5 rounded-full border bg-background py-1.5 pl-3 pr-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {chip.label}
            <XIcon className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t("catalog.removeFilter")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};
