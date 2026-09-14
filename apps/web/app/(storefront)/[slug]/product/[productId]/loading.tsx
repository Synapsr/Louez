import { Skeleton } from "@louez/ui";

import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

const RELATED_PLACEHOLDERS = 4;

/** Same grid as the page: breadcrumb, gallery, booking column, description, related. */
export default function ProductLoading() {
  return (
    <StorefrontSection
      spacing="tight"
      contentClassName="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-x-12"
    >
      <div className="col-span-full flex items-center gap-2 lg:row-start-1">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-32" />
      </div>

      <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
        <Skeleton className="aspect-4/3 w-full rounded-2xl" />
        <div className="hidden gap-2 lg:flex">
          {Array.from({ length: RELATED_PLACEHOLDERS }, (_, index) => (
            <Skeleton key={index} className="aspect-4/3 w-20 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-2">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex flex-col gap-5 rounded-2xl bg-card p-4 shadow-card sm:p-6">
          <Skeleton className="h-11 w-full rounded-lg" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-11 w-32 rounded-lg sm:h-9" />
          </div>
          <Skeleton className="hidden h-10 w-full rounded-lg lg:block" />
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      <div className="col-span-full flex flex-col gap-4 lg:row-start-4 sm:gap-6">
        <Skeleton className="h-7 w-48" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
          {Array.from({ length: RELATED_PLACEHOLDERS }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-2xl bg-card shadow-card">
              <Skeleton className="aspect-4/3 w-full rounded-t-2xl rounded-b-none" />
              <div className="flex flex-col gap-2 px-3 pb-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </StorefrontSection>
  );
}
