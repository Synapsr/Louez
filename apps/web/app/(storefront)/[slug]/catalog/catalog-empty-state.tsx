"use client";

import { PackageIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

import { EmptyState } from "@/components/storefront/ui/empty-state";

interface CatalogEmptyStateProps {
  /** The search term that found nothing, if any. */
  search: string;
  /** Clears category and search: back to every product. */
  onShowAll: () => void;
  onShowUnavailable?: () => void;
  period: RentalPeriodValue | null;
  onPeriodChange: (period: RentalPeriodValue) => void;
  rules: RentalPeriodRules;
}

/** No product for these filters: one line and one way out, the whole catalog. */
export const CatalogEmptyState = ({
  search,
  onShowAll,
  onShowUnavailable,
  period,
  onPeriodChange,
  rules,
}: CatalogEmptyStateProps) => {
  const t = useTranslations("storefront.catalog");

  return (
    <EmptyState
      tone="card"
      icon={<PackageIcon />}
      title={search ? t("noProductsFor", { search }) : t("noProducts")}
      description={t("noProductsDescription")}
      action={
        <div className="flex flex-wrap items-center justify-center gap-3">
          {period ? (
            <RentalPeriodPicker
              layout="compact"
              value={period}
              onChange={onPeriodChange}
              rules={rules}
            />
          ) : null}
          {onShowUnavailable ? (
            <Button variant="outline" className="h-12 lg:h-10" onClick={onShowUnavailable}>
              {t("showUnavailable")}
            </Button>
          ) : null}
          <Button variant="ghost" className="h-12 lg:h-10" onClick={onShowAll}>
            {t("clearFilters")}
          </Button>
        </div>
      }
    />
  );
};
