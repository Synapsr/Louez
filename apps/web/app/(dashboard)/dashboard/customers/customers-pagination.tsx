"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";

export const CUSTOMER_PAGE_SIZES = [25, 50, 100] as const;
export type CustomerPageSize = (typeof CUSTOMER_PAGE_SIZES)[number];

interface CustomersPaginationProps {
  totalCount: number;
  page: number;
  pageSize: number;
}

export const CustomersPagination = ({ totalCount, page, pageSize }: CustomersPaginationProps) => {
  const t = useTranslations("dashboard.customers.pagination");
  const router = useRouter();
  const searchParams = useSearchParams();

  if (totalCount === 0) return null;

  const pages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  const update = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.push(`/dashboard/customers?${params.toString()}`);
  };

  return (
    <div className="flex flex-col items-center justify-between gap-4 px-2 sm:flex-row">
      <p className="text-muted-foreground text-sm tabular-nums">
        {t("showing", { from, to, total: totalCount })}
      </p>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{t("perPage")}</span>
          <Select
            items={CUSTOMER_PAGE_SIZES.map((size) => ({
              value: String(size),
              label: String(size),
            }))}
            value={String(pageSize)}
            onValueChange={(value) =>
              value !== null && update({ pageSize: value === "25" ? null : value, page: null })
            }
          >
            <SelectTrigger className="h-8 w-20" aria-label={t("perPage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)} label={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-muted-foreground text-sm tabular-nums">
          {t("pageOf", { page, pages })}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("previous")}
            disabled={page <= 1}
            onClick={() => update({ page: page - 1 > 1 ? String(page - 1) : null })}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("next")}
            disabled={page >= pages}
            onClick={() => update({ page: String(page + 1) })}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
