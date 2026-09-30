"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button } from "@louez/ui";

export interface CustomersActiveFilter {
  key: string;
  label: string;
}

interface CustomersActiveFiltersProps {
  filters: CustomersActiveFilter[];
  onRemove: (key: string) => void;
  onReset: () => void;
}

/** What currently narrows the list, each removable: a filter hidden in a popover must stay visible. */
export const CustomersActiveFilters = ({
  filters,
  onRemove,
  onReset,
}: CustomersActiveFiltersProps) => {
  const t = useTranslations("dashboard.customers.filter");
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <Badge key={filter.key} variant="secondary" className="gap-1 pr-1">
          {filter.label}
          <button
            type="button"
            aria-label={`${t("remove")} : ${filter.label}`}
            className="hover:bg-background/60 rounded-lg p-0.5"
            onClick={() => onRemove(filter.key)}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={onReset}>
        {t("reset")}
      </Button>
    </div>
  );
};
