import type { ReactNode } from "react";

import { cn } from "@louez/utils";

type StickyActionBarDesktop = "static" | "hidden";

interface StickyActionBarProps {
  /**
   * At `lg` and up: `static` drops the bar back into the flow (a form's
   * submit row), `hidden` removes it (a product page whose desktop panel
   * already holds the button).
   */
  desktop?: StickyActionBarDesktop;
  className?: string;
  children: ReactNode;
}

/**
 * Bottom action bar for phones: sticks to the viewport edge, clears the home
 * indicator, one primary button (`h-12`). It is `sticky`, not `fixed`, so it
 * needs no spacer — place it as the LAST child of the page column and it
 * stays visible until the user reaches the end of the page.
 *
 * Bleeds across the `StorefrontSection` gutter (`-mx-4 sm:-mx-6`); a page
 * with another gutter passes its own negative margins through `className`.
 * The advisor launcher lifts itself when `[data-slot=sticky-action-bar]`
 * is on the page.
 */
export const StickyActionBar = ({
  desktop = "static",
  className,
  children,
}: StickyActionBarProps) => (
  <div
    className={cn(
      "sticky bottom-0 z-30 -mx-4 mt-6 flex items-center gap-3 border-t bg-background/90 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(3))] shadow-overlay backdrop-blur supports-backdrop-filter:bg-background/80 sm:-mx-6 sm:px-6",
      "max-lg:**:data-[slot=button]:h-12 max-lg:**:data-[slot=button]:text-sm max-lg:**:data-[slot=button]:font-semibold",
      desktop === "static" &&
        "lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none",
      desktop === "hidden" && "lg:hidden",
      className,
    )}
    data-slot="sticky-action-bar"
  >
    {children}
  </div>
);
