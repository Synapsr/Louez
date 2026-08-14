"use client";

import { useTranslations } from "next-intl";

import { Card } from "@louez/ui";
import { LayersIcon, ProductIcon, TagIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

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
  onSelect: (categoryId: string) => void;
  className?: string;
}

const VARIANT_ICON = {
  category: LayersIcon,
  uncategorized: TagIcon,
  all: ProductIcon,
} as const;

export function CategoryBrowseGrid({
  entries,
  isAvailabilityLoading,
  showTotalsOnly = false,
  showTitle = true,
  onSelect,
  className,
}: CategoryBrowseGridProps) {
  const t = useTranslations("storefront.availability");
  const tBrowse = useTranslations("storefront.availability.categoryBrowse");

  if (entries.length === 0) return null;

  const showTotals = showTotalsOnly || isAvailabilityLoading;

  return (
    <div className={cn("space-y-3", className)}>
      {showTitle && <h2 className="text-base font-semibold">{tBrowse("title")}</h2>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-4">
        {entries.map((entry) => {
          const Icon = VARIANT_ICON[entry.variant];
          const isAll = entry.variant === "all";
          const countLabel = showTotals
            ? t("productCountPlural", { count: entry.totalCount })
            : tBrowse("availableCount", { count: entry.availableCount });

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry.id)}
              className="group focus-visible:ring-ring rounded-xl text-left focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Card
                className={cn(
                  "h-full cursor-pointer gap-0 overflow-hidden p-0 transition-all duration-200 motion-reduce:transition-none",
                  isAll
                    ? "border-primary/40 bg-primary/5 group-hover:border-primary/60 group-hover:shadow-md"
                    : "group-hover:border-primary/30 group-hover:shadow-md",
                )}
              >
                <div className="bg-muted relative aspect-[4/3] overflow-hidden">
                  {entry.imageUrl ? (
                    <SharedImage
                      src={entry.imageUrl}
                      alt={entry.name}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw"
                      fallbackIcon={Icon}
                      containerClassName="absolute inset-0 rounded-none"
                      className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-0 flex items-center justify-center",
                        isAll ? "bg-primary/10" : "bg-muted",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-8 transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100",
                          isAll ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-1 p-3">
                  <p className="line-clamp-1 text-sm font-medium">{entry.name}</p>
                  {entry.description && (
                    <p className="text-muted-foreground line-clamp-2 text-xs">
                      {entry.description}
                    </p>
                  )}
                  <p
                    className={cn(
                      "text-xs font-medium",
                      showTotals ? "text-muted-foreground" : "text-primary",
                    )}
                  >
                    {countLabel}
                  </p>
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
