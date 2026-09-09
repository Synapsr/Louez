"use client";

import { useSearchParams } from "next/navigation";

import { Skeleton } from "@louez/ui";
import { cn } from "@louez/utils";

import { ProductGridSkeleton } from "@/components/storefront/product/product-grid-skeleton";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { countActiveCatalogFilters, readCatalogFilters } from "@/lib/utils/util.rental-browse";

const CATEGORY_WIDTHS = ["w-28", "w-24", "w-20", "w-32", "w-16", "w-36", "w-20"];

const CatalogLoading = () => {
  const searchParams = useSearchParams();
  const activeCount = countActiveCatalogFilters(readCatalogFilters(searchParams));

  return (
    <StorefrontSection spacing="tight" className="pb-8 sm:pb-12">
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10" aria-hidden="true">
        <div className="hidden w-60 shrink-0 flex-col gap-5 lg:flex">
          <div>
            <div className="flex h-8 items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-3" />
            </div>
            <div className="flex flex-col gap-0.5 pb-2 pt-1">
              {CATEGORY_WIDTHS.map((width, index) => (
                <div key={index} className="flex h-9 items-center justify-between px-3">
                  <Skeleton className={cn("h-4", width)} />
                  <Skeleton className="h-3 w-4" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex h-8 items-center">
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex flex-col gap-3 pb-2 pt-1">
              <div className="flex h-5 items-center gap-2">
                <Skeleton className="size-4" />
                <Skeleton className="h-4 w-28" />
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-9 w-32 rounded-lg" />
              </div>
            </div>
          </div>
          {[0, 1].map((section) => (
            <div key={section}>
              <div className="flex h-8 items-center">
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="flex flex-col gap-2 pb-2 pt-1">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="flex h-7 items-center gap-2">
                    <Skeleton className="size-4" />
                    <Skeleton className={row % 2 === 0 ? "h-4 w-20" : "h-4 w-12"} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 sm:gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Skeleton className="h-7.5 w-40 sm:h-9 sm:w-48" />
              <Skeleton className="mt-1 h-5 w-24 sm:h-6" />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton className="h-11 w-24 rounded-md sm:h-9 lg:hidden" />
              <Skeleton className="h-11 w-40 rounded-md sm:h-9" />
            </div>
          </div>
          {activeCount > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {Array.from({ length: activeCount }, (_, index) => (
                <Skeleton key={index} className="h-8.5 w-28 rounded-full" />
              ))}
            </div>
          ) : null}
          <ProductGridSkeleton count={12} />
        </div>
      </div>
    </StorefrontSection>
  );
};

export default CatalogLoading;
