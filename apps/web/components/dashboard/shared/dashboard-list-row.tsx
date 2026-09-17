import type { ReactNode } from "react";

import Link from "next/link";

import { ChevronRight } from "lucide-react";

import { cn } from "@louez/utils";

interface DashboardListRowProps {
  href: string;
  onSelect?: () => void;
  /** Icon tile or avatar. */
  leading: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  /** Trailing value (amount, count, …) shown before the chevron. */
  meta?: ReactNode;
  className?: string;
}

/**
 * The single row shape of the dashboard lists.
 *
 * The affordance is a chevron that is always rendered (rows used to reveal
 * their action on `:hover` only, which never fired on touch devices) and
 * nudges to the right on hover.
 */
export const DashboardListRow = ({
  href,
  onSelect,
  leading,
  title,
  subtitle,
  meta,
  className,
}: DashboardListRowProps) => {
  const rowClassName = cn(
    "group hover:bg-muted/60 focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none sm:px-3",
    className,
  );
  const content = (
    <>
      {leading}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">{title}</div>
        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
          {subtitle}
        </div>
      </div>
      {meta && <div className="shrink-0 text-sm font-medium tabular-nums">{meta}</div>}
      <ChevronRight className="text-muted-foreground/60 group-hover:text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </>
  );
  return onSelect ? (
    <button type="button" onClick={onSelect} className={cn(rowClassName, "w-full text-left")}>
      {content}
    </button>
  ) : (
    <Link href={href} className={rowClassName}>
      {content}
    </Link>
  );
};
