import type { ComponentProps, ReactNode } from "react";

import { cn } from "@louez/utils";

import { GlassIllustration } from "./glass-illustration";

interface DashboardPageEmptyStateProps {
  illustration: Pick<ComponentProps<typeof GlassIllustration>, "main" | "companions">;
  title: string;
  description: string;
  /** The main action first, then at most one secondary one. */
  actions?: ReactNode;
  /** A one-line hint under the actions, e.g. a shortcut the empty page hides. */
  tip?: ReactNode;
  className?: string;
}

/**
 * Empty state of a whole page (no reservations, no products, no customers):
 * a Lagon glass illustration, what the page will hold, and the way to fill it.
 * Sections inside a page keep the smaller `DashboardEmptyState`.
 */
export const DashboardPageEmptyState = ({
  illustration,
  title,
  description,
  actions,
  tip,
  className,
}: DashboardPageEmptyStateProps) => (
  <section
    className={cn(
      "flex flex-col items-center justify-center gap-7 px-4 py-12 text-center sm:py-16",
      className,
    )}
  >
    <GlassIllustration {...illustration} />
    <div className="animate-enter flex max-w-md flex-col items-center gap-2 [animation-delay:80ms]">
      <h2 className="text-xl font-extrabold tracking-tight text-balance sm:text-2xl">{title}</h2>
      <p className="text-muted-foreground text-sm text-balance sm:text-base">{description}</p>
    </div>
    {actions && (
      <div className="animate-enter flex flex-wrap items-center justify-center gap-2 [animation-delay:120ms]">
        {actions}
      </div>
    )}
    {tip && (
      <div className="animate-enter bg-muted text-muted-foreground w-full max-w-lg rounded-[14px] px-4 py-3 text-left text-sm shadow-[inset_0_0_0_1px_var(--color-border)] [animation-delay:160ms]">
        {tip}
      </div>
    )}
  </section>
);
