"use client";
import type { ReactNode } from "react";
import { cn } from "@louez/utils";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import type { CatalogSort } from "@/lib/storefront/catalog.constants";
import { CatalogHeader } from "./catalog-header";
import { CatalogFiltersDrawer } from "./catalog-filters-drawer";
import { CatalogSortSelect } from "./catalog-sort-select";

export const CatalogLayout = ({
  title,
  count,
  totalCount,
  showSidebar,
  sidebar,
  activeCount,
  sort,
  onSortChange,
  activeFilters,
  children,
}: {
  title: string;
  count: number;
  totalCount: number;
  showSidebar: boolean;
  sidebar: ReactNode;
  activeCount: number;
  sort: CatalogSort;
  onSortChange: (sort: CatalogSort) => void;
  activeFilters: ReactNode;
  children: ReactNode;
}) => (
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
              activeCount={activeCount}
              resultCount={count}
              className={cn("h-11 shrink-0 gap-1.5 px-3 sm:h-9", showSidebar && "lg:hidden")}
            >
              {sidebar}
            </CatalogFiltersDrawer>
            {totalCount > 1 ? <CatalogSortSelect value={sort} onChange={onSortChange} /> : null}
          </div>
        </div>
        {activeFilters}
        {children}
      </div>
    </div>
  </StorefrontSection>
);
