import { Skeleton } from "@louez/ui";

import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

const CheckoutLoading = () => (
  <StorefrontSection spacing="tight">
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-14 w-full rounded-2xl lg:hidden" />
      <Skeleton className="h-10 w-full" />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-7 w-40" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-11 w-full sm:h-9" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-11 w-full sm:h-9" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-11 w-full sm:h-9" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-11 w-full sm:h-9" />
          </div>
          <Skeleton className="mt-2 h-12 w-full lg:ml-auto lg:h-10 lg:w-40" />
        </div>

        <div className="hidden flex-col gap-4 rounded-2xl bg-card p-6 shadow-card lg:flex">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-full rounded-lg" />
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="h-12 w-16 shrink-0 rounded-lg" />
              <div className="flex flex-1 flex-col gap-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
          <div className="flex flex-col gap-2 border-t pt-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </div>
      </div>
    </div>
  </StorefrontSection>
);

export default CheckoutLoading;
