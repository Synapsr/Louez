import { Skeleton } from "@louez/ui";
import { cn } from "@louez/utils";

import { productGridClassName } from "./product-grid.constants";

interface ProductGridSkeletonProps {
  /** Cards to draw; a full first screen by default. */
  count?: number;
  className?: string;
}

/** Placeholder grid with the card's exact shape, so the page does not jump. */
export const ProductGridSkeleton = ({ count = 8, className }: ProductGridSkeletonProps) => (
  <div
    className={cn(productGridClassName, className)}
    aria-hidden="true"
    data-slot="product-grid-skeleton"
  >
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="flex flex-col gap-2 rounded-2xl bg-card shadow-card">
        <div className="p-1 pb-0">
          <Skeleton className="aspect-4/3 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-1 px-2 pb-2">
          <Skeleton className="h-5 w-3/4 sm:h-6" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      </div>
    ))}
  </div>
);
