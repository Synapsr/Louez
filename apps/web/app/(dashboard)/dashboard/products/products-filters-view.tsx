"use client";

import { useTranslations } from "next-intl";
import { Badge, Tabs, TabsList, TabsTab } from "@louez/ui";
import { SearchInput } from "@/components/ui/search-input";
import { CategoryFilterCombobox, type CategoryFilterOption } from "./category-filter-combobox";
import { PRODUCT_STATUS_FILTERS, type ProductCounts, type ProductStatusFilter } from "./types";

export interface ProductsFiltersViewProps {
  categories: CategoryFilterOption[];
  counts: ProductCounts;
  isLoadingCategories?: boolean;
  autoFocus?: boolean;
  searchDisabled?: boolean;
  status: ProductStatusFilter;
  categoryIds: string[];
  search: string;
  setStatus: (status: ProductStatusFilter) => void;
  setCategoryIds: (ids: string[]) => void;
  setSearch: (search: string) => void;
}

export const ProductsFiltersView = ({
  categories,
  counts,
  isLoadingCategories = false,
  autoFocus = true,
  searchDisabled = false,
  status,
  categoryIds,
  search,
  setStatus,
  setCategoryIds,
  setSearch,
}: ProductsFiltersViewProps) => {
  const t = useTranslations("dashboard.products");

  const statusOptions = [
    { value: "all", label: t("filters.all") },
    { value: "active", label: t("filters.active") },
    { value: "draft", label: t("filters.draft") },
    { value: "archived", label: t("filters.archived") },
  ] satisfies { value: ProductStatusFilter; label: string }[];

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-4">
      {/* Status filter — same underlined tabs as the reservations page,
          horizontally scrollable when overflowing */}
      <div className="-mx-1 min-w-0 max-w-full overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Tabs
          value={status}
          onValueChange={(value) => {
            const status = PRODUCT_STATUS_FILTERS.find((status) => status === value);
            if (status) setStatus(status);
          }}
        >
          <TabsList variant="underline">
            {statusOptions.map((option) => {
              const isActive = status === option.value;

              return (
                <TabsTab key={option.value} value={option.value}>
                  {option.label}
                  <Badge variant={isActive ? "progress" : "expired"} size="sm">
                    {counts[option.value]}
                  </Badge>
                </TabsTab>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      <SearchInput
        disabled={searchDisabled}
        enableShortcut={!searchDisabled}
        groupClassName="w-full sm:w-64"
        value={search}
        maxLength={100}
        onChange={(event) => setSearch(event.target.value)}
        onClear={() => setSearch("")}
        placeholder={t("searchProducts")}
        clearLabel={t("clearSearch")}
      />

      {(categories.length > 0 || categoryIds.length > 0) && (
        <CategoryFilterCombobox
          autoFocus={autoFocus}
          categories={categories}
          isLoading={isLoadingCategories}
          selectedCategoryIds={categoryIds}
          onChange={setCategoryIds}
        />
      )}
    </div>
  );
};
