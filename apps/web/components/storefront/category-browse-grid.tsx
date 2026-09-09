"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import { LayersIcon, ProductIcon, TagIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { SharedImage } from "@/components/ui/shared-image";

/** Reserved `?category=` values, so "browse everything" and "no category" stay
 * distinguishable from "nothing picked yet" (no param at all). */
export const ALL_CATEGORIES_VALUE = "all";
export const UNCATEGORIZED_CATEGORY_VALUE = "uncategorized";

export interface CategoryBrowseEntry {
  /** A category id, or one of the reserved values above. */
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  /** Products in this bucket that can be booked for the selected dates. */
  availableCount: number;
  /** Products in this bucket, availability aside. Shown while availability loads. */
  totalCount: number;
  variant: "category" | "uncategorized" | "all";
  /**
   * Store-relative catalog link. When set the tile is a real link
   * (crawlable, middle-clickable); otherwise it is a button firing `onSelect`.
   */
  href?: string;
}

interface CategoryBrowseGridProps {
  entries: CategoryBrowseEntry[];
  /** While true the cards show the total count instead of the available count. */
  isAvailabilityLoading: boolean;
  /**
   * Surfaces without selected dates (the homepage) have no availability to
   * report at all, so the cards advertise the bucket size permanently.
   */
  showTotalsOnly?: boolean;
  /** The grid owns its heading by default; pass false when the host section already has one. */
  showTitle?: boolean;
  /** Client-side selection, for entries without an `href`. */
  onSelect?: (categoryId: string) => void;
  className?: string;
}

const VARIANT_ICON = {
  category: LayersIcon,
  uncategorized: TagIcon,
  all: ProductIcon,
} as const;

/** Same surface as a product card: inset image, hairline that darkens, image zoom. */
const tileClassName =
  "group flex h-full w-full flex-col gap-2 rounded-2xl bg-card text-left shadow-card outline-none transition-shadow duration-150 hover:ring-1 hover:ring-foreground/12 focus-visible:ring-2 focus-visible:ring-ring";

interface CategoryTileProps {
  entry: CategoryBrowseEntry;
  onSelect?: (categoryId: string) => void;
  children: ReactNode;
}

const CategoryTile = ({ entry, onSelect, children }: CategoryTileProps) =>
  entry.href ? (
    <StorefrontLink href={entry.href} className={tileClassName}>
      {children}
    </StorefrontLink>
  ) : (
    <button type="button" onClick={() => onSelect?.(entry.id)} className={tileClassName}>
      {children}
    </button>
  );

/**
 * Category tiles: image or icon, name, product count. Each tile is a link
 * when the entry carries an `href` (home page) or a button when the host
 * filters in place (catalog).
 */
export const CategoryBrowseGrid = ({
  entries,
  isAvailabilityLoading,
  showTotalsOnly = false,
  showTitle = true,
  onSelect,
  className,
}: CategoryBrowseGridProps) => {
  const t = useTranslations("storefront.availability");

  if (entries.length === 0) return null;

  const showTotals = showTotalsOnly || isAvailabilityLoading;

  return (
    <div className={cn("flex flex-col gap-3", className)} data-slot="category-browse-grid">
      {showTitle ? (
        <h2 className="text-lg font-semibold leading-snug">{t("categoryBrowse.title")}</h2>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
        {entries.map((entry) => {
          const Icon = VARIANT_ICON[entry.variant];
          const isAll = entry.variant === "all";
          const countLabel = showTotals
            ? t("productCountPlural", { count: entry.totalCount })
            : t("categoryBrowse.availableCount", { count: entry.availableCount });

          return (
            <li key={entry.id} className="flex">
              <CategoryTile entry={entry} onSelect={onSelect}>
                {/* Inset image, as on the product card: the frame's radius is
                    concentric with the tile's (outer = inner + padding). */}
                <div className="p-1 pb-0">
                  <div className="relative aspect-4/3 overflow-hidden rounded-xl bg-muted shadow-[0_0_1px_0.75px_var(--color-border)]">
                    {entry.imageUrl ? (
                      <SharedImage
                        src={entry.imageUrl}
                        alt=""
                        fill
                        sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
                        fallbackIcon={Icon}
                        containerClassName="absolute inset-0 rounded-none"
                        // `scale` is its own property in Tailwind v4, not part of `transform`.
                        className="object-cover motion-safe:transition-[opacity,scale] motion-safe:duration-[400ms] motion-safe:ease-out motion-safe:group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 flex items-center justify-center text-muted-foreground"
                      >
                        <Icon className="size-8" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1 px-2 pb-2">
                  <h3
                    className={cn(
                      "line-clamp-1 text-sm font-medium sm:text-base",
                      isAll && "font-semibold",
                    )}
                  >
                    {entry.name}
                  </h3>
                  {entry.description ? (
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {entry.description}
                    </p>
                  ) : null}
                  <p
                    className={cn(
                      "text-xs tabular-nums",
                      showTotals ? "text-muted-foreground" : "font-medium text-success",
                    )}
                  >
                    {countLabel}
                  </p>
                </div>
              </CategoryTile>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
