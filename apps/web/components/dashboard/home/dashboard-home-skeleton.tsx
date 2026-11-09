import { Skeleton } from "@louez/ui";

/** Same shape as the home: greeting, then the two full-height cards. */
export const DashboardHomeSkeleton = () => {
  return (
    <div className="flex flex-col gap-5 sm:gap-6 lg:min-h-[calc(100svh-8.5rem)]">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid flex-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-5">
        <Skeleton className="min-h-72 rounded-2xl" />
        <Skeleton className="min-h-72 rounded-2xl" />
      </div>
    </div>
  );
};
