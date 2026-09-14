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
  /** `sm` for a category shown as a label; `default` for a filter row. */
  size?: "default" | "sm";
  className?: string;
  children: ReactNode;
}

const sizeClasses = {
  // Filter chip in a horizontal `snap-x` row: 36 px with a mouse, 44 px on a
  // coarse pointer.
  default: "h-9 px-4 text-sm pointer-coarse:h-11",
  // A category that only labels the page it sits on: still tappable, but it
  // stops eating the space above the title.
  sm: "h-7 px-3 text-xs pointer-coarse:h-9",
} as const;

/** Category chip. Selected = primary (one of the three uses primary keeps). */
export const CategoryPill = ({
  selected = false,
  href,
  onClick,
  count,
  size = "default",
  className,
  children,
}: CategoryPillProps) => (
  <Button
    variant={selected ? "default" : "outline"}
    className={cn("shrink-0 snap-start rounded-full font-medium", sizeClasses[size], className)}
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
