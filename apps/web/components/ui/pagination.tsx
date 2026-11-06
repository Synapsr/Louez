"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";
import { cn } from "@louez/utils";

interface PaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  /** With its sizes, shows the "per page" selector. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizes?: readonly number[];
  className?: string;
}

/**
 * Server-side pagination footer of the dashboard lists. It owns no state and no
 * URL: the list decides where the page lives (nuqs, router, …).
 */
export const Pagination = ({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizes = [],
  className,
}: PaginationProps) => {
  const t = useTranslations("common.pagination");

  if (totalCount === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div
      className={cn("flex flex-col items-center justify-between gap-4 px-2 sm:flex-row", className)}
    >
      <div className="text-muted-foreground text-sm">
        {t("showing", { start, end, total: totalCount })}
      </div>

      <div className="flex items-center gap-4">
        {onPageSizeChange && pageSizes.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{t("perPage")}</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                if (value !== null) onPageSizeChange(Number(value));
              }}
            >
              <SelectTrigger className="h-8 w-18" aria-label={t("perPage")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizes.map((size) => (
                  <SelectItem key={size} value={String(size)} label={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label={t("previous")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-20 px-2 text-center text-sm tabular-nums">
            {t("page", { current: page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label={t("next")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
