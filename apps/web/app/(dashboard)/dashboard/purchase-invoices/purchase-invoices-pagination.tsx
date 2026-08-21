import Link from "next/link";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";

type PurchaseInvoicesPaginationProps = {
  page: number;
  pageCount: number;
  totalCount: number;
};

/**
 * The inbox has no filters, so the page number is the whole query string —
 * plain links keep this a server component and keep the pages linkable.
 */
export const PurchaseInvoicesPagination = async ({
  page,
  pageCount,
  totalCount,
}: PurchaseInvoicesPaginationProps) => {
  const t = await getTranslations("dashboard.purchaseInvoices.pagination");

  if (pageCount <= 1) return null;

  const hrefForPage = (target: number) =>
    target <= 1 ? "/dashboard/purchase-invoices" : `/dashboard/purchase-invoices?page=${target}`;

  return (
    <div className="flex flex-col items-center justify-between gap-3 px-2 sm:flex-row">
      <p className="text-muted-foreground text-sm">{t("total", { count: totalCount })}</p>

      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          disabled={page <= 1}
          aria-label={t("previous")}
          render={page <= 1 ? undefined : <Link href={hrefForPage(page - 1)} />}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-20 px-2 text-center text-sm">
          {t("page", { current: page, total: pageCount })}
        </span>
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          disabled={page >= pageCount}
          aria-label={t("next")}
          render={page >= pageCount ? undefined : <Link href={hrefForPage(page + 1)} />}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
};
