"use client";

import type { ReactNode } from "react";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { StorefrontLink } from "@/components/storefront/ui/storefront-link";

interface CategoryPillProps {
  selected?: boolean;
  /** Renders a real link (crawlable, middle-clickable); omit for client filtering. */
  href?: string;
  onClick?: () => void;
  count?: number;
  className?: string;
  children: ReactNode;
}

/**
 * Filter chip for a horizontal `snap-x` row: 36 px with a mouse, 44 px on a
 * coarse pointer. Selected = primary (one of the three uses primary keeps).
 */
export const CategoryPill = ({
  selected = false,
  href,
  onClick,
  count,
  className,
  children,
}: CategoryPillProps) => (
  <Button
    variant={selected ? "default" : "outline"}
    className={cn(
      "h-9 shrink-0 snap-start rounded-full px-4 text-sm font-medium pointer-coarse:h-11",
      className,
    )}
    render={
      href ? <StorefrontLink href={href} aria-current={selected ? "page" : undefined} /> : undefined
    }
    aria-pressed={href ? undefined : selected}
    onClick={onClick}
  >
    {children}
    {count != null ? (
      <span className="tabular-nums text-xs opacity-70" data-slot="category-pill-count">
        {count}
      </span>
    ) : null}
  </Button>
);
