import type { ReactNode } from "react";

import { cn } from "@louez/utils";

type StickyActionBarDesktop = "static" | "hidden";
type StickyActionBarPlacement = "sticky" | "fixed";

interface StickyActionBarProps {
  /**
   * At `lg` and up: `static` drops the bar back into the flow (a form's
   * submit row), `hidden` removes it (a product page whose desktop panel
   * already holds the button).
   */
  desktop?: StickyActionBarDesktop;
  /**
   * On phones: `sticky` needs no spacer but lands as soon as the end of its
   * column scrolls in, so it only suits a column that runs to the end of the
   * page. `fixed` holds the bar at the viewport edge past the store footer —
   * the caller owes the page the bar's height back.
   */
  placement?: StickyActionBarPlacement;
  className?: string;
  children: ReactNode;
}

/**
 * Bottom action bar for phones: holds the viewport edge, clears the home
 * indicator, one primary button (`h-12`).
 *
 * The `sticky` placement bleeds across the `StorefrontSection` gutter
 * (`-mx-4 sm:-mx-6`); a page with another gutter passes its own negative
 * margins through `className`. The advisor launcher lifts itself when
 * `[data-slot=sticky-action-bar]` is on the page.
 */
export const StickyActionBar = ({
  desktop = "static",
  placement = "sticky",
  className,
  children,
}: StickyActionBarProps) => (
  <div
    className={cn(
      "bottom-0 z-30 flex items-center gap-3 border-t bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(3))] sm:px-6",
      "max-lg:**:data-[slot=button]:h-12 max-lg:**:data-[slot=button]:text-sm max-lg:**:data-[slot=button]:font-semibold",
      placement === "sticky" ? "sticky -mx-4 mt-6 sm:-mx-6" : "fixed inset-x-0",
      desktop === "static" && "lg:static lg:mx-0 lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 ",
      desktop === "hidden" && "lg:hidden",
      className,
    )}
    data-slot="sticky-action-bar"
  >
    {children}
  </div>
);
