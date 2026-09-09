"use client";

import { ArrowUpDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@louez/ui";
import { cn } from "@louez/utils";

import {
  CATALOG_SORT_VALUES,
  type CatalogSort,
  isCatalogSort,
} from "@/lib/storefront/catalog.constants";

interface CatalogSortSelectProps {
  value: CatalogSort;
  onChange: (sort: CatalogSort) => void;
  className?: string;
}

/** Sort control of the catalog header: an icon on phones, icon and label from `sm`. */
export const CatalogSortSelect = ({ value, onChange, className }: CatalogSortSelectProps) => {
  const t = useTranslations("storefront.catalog.sort");

  return (
    <Select
      value={value}
      onValueChange={(next: string | null) => {
        if (isCatalogSort(next)) onChange(next);
      }}
    >
      <SelectTrigger
        aria-label={t("label")}
        className={cn("h-11 w-auto min-w-0 shrink-0 gap-1.5 px-3 sm:h-9", className)}
      >
        <ArrowUpDownIcon className="size-4 text-muted-foreground" aria-hidden />
        <SelectValue className="hidden sm:flex">{t(value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end">
        {CATALOG_SORT_VALUES.map((sort) => (
          <SelectItem key={sort} value={sort} label={t(sort)}>
            {t(sort)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
};
