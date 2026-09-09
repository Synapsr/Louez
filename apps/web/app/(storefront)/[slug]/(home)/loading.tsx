import { Skeleton } from "@louez/ui";

import { ProductGridSkeleton } from "@/components/storefront/product/product-grid-skeleton";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

/** Same bands as the page: hero, inventory, reassurance line, location. */
const StoreLoading = () => (
  <div aria-busy="true" aria-hidden="true">
    <section className="-mt-14 flex min-h-[70svh] items-end bg-muted md:-mt-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pt-24 pb-8 sm:px-6 sm:pb-12 lg:px-8">
        <div className="flex max-w-3xl flex-col gap-3">
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
          </div>
          <Skeleton className="h-8 w-64 sm:h-9 sm:w-80" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
        <Skeleton className="h-40 w-full max-w-2xl rounded-2xl" />
      </div>
    </section>

    <StorefrontSection>
      <div className="mb-4 flex items-end justify-between sm:mb-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-16" />
      </div>
      <ProductGridSkeleton />
    </StorefrontSection>

    <StorefrontSection spacing="tight">
      <div className="flex flex-wrap justify-center gap-6">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-5 w-36" />
        ))}
      </div>
    </StorefrontSection>

    <StorefrontSection>
      <Skeleton className="mb-4 h-7 w-32 sm:mb-6" />
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 py-1.5">
              <Skeleton className="size-11 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl sm:h-80" />
      </div>
    </StorefrontSection>
  </div>
);

export default StoreLoading;
