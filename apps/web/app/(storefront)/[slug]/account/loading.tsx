import { Skeleton } from "@louez/ui";

import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

/** Traces the loaded page: one title, then a stack of reservation cards. */
export default function AccountLoading() {
  return (
    <StorefrontSection contentClassName="flex max-w-5xl flex-col gap-6 sm:gap-8">
      <Skeleton className="h-8 w-56 max-w-full" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <div className="flex flex-col gap-2 sm:gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-2xl bg-card p-1 shadow-card sm:gap-4"
            >
              <Skeleton className="aspect-4/3 w-20 shrink-0 rounded-xl sm:w-24" />
              <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
              <Skeleton className="me-2 h-5 w-16 shrink-0 sm:me-3" />
            </div>
          ))}
        </div>
      </div>
    </StorefrontSection>
  );
}
