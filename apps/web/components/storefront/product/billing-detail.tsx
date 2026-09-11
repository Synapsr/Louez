"use client";

import { useTranslations } from "next-intl";
import { cn } from "@louez/utils";

import { usePeriodLabel } from "@/hooks/use-period-label";
import type { StorefrontBillingDetail } from "@/lib/utils/util.storefront-product-pricing";

interface BillingDetailProps {
  detail: StorefrontBillingDetail | null;
  className?: string;
}

export const BillingDetail = ({ detail, className }: BillingDetailProps) => {
  const t = useTranslations("storefront.product.booking");
  const formatPeriod = usePeriodLabel();
  if (!detail) return null;

  return (
    <span
      className={cn("block text-xs text-muted-foreground", className)}
      data-slot="billing-detail"
    >
      {detail.mode === "prorated"
        ? t("proratedPrice")
        : detail.mode === "package"
          ? t(detail.count > 1 ? "packagesApplied" : "packageApplied", {
              period: formatPeriod(detail.periodMinutes, { alwaysShowCount: true }),
              count: detail.count,
            })
          : t("rateApplied", {
              period: formatPeriod(detail.periodMinutes, { alwaysShowCount: true }),
            })}
    </span>
  );
};
