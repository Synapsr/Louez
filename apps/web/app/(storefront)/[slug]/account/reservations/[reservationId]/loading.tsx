import { Skeleton } from "@louez/ui";

import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

export default function ReservationDetailLoading() {
  return (
    <StorefrontSection contentClassName="flex max-w-6xl flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
        <Skeleton className="h-12 w-full sm:h-10 sm:w-44" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-card sm:p-6"
          >
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </StorefrontSection>
  );
}
