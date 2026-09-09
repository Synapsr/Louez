import { Skeleton } from "@louez/ui";

import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

export default function LoginLoading() {
  return (
    <StorefrontSection
      width="narrow"
      className="bg-background sm:py-16"
      contentClassName="max-w-lg"
    >
      <Skeleton className="mb-6 h-11 w-32" />
      <div className="flex flex-col gap-6 rounded-3xl border bg-card p-6 shadow-card sm:gap-8 sm:p-8">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-2xl" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-12 w-full" />
          </div>
          <Skeleton className="h-12 w-full" />
        </div>
        <Skeleton className="mx-auto h-3 w-48" />
      </div>
    </StorefrontSection>
  );
}
