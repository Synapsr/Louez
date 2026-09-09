"use client";

import { useLocale, useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { formatDetailedDuration } from "@/lib/utils/duration";
import { formatRentalPeriod } from "@/lib/utils/store-date";

import type { RentalPeriodValue } from "./core/types";

interface PeriodSummaryProps {
  period: RentalPeriodValue | null;
  timezone?: string;
  className?: string;
}

/** Live summary line of the draft: "3–5 mars · 2 jours". */
export const PeriodSummary = ({ period, timezone, className }: PeriodSummaryProps) => {
  const t = useTranslations("storefront.dateSelection");
  const locale = useLocale();

  if (!period) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{t("chooseDates")}</p>;
  }

  const duration = formatDetailedDuration(period.start, period.end, {
    day: t("durationDay"),
    days: t("durationDays"),
    and: t("and"),
  });

  return (
    <p className={cn("text-sm", className)}>
      <span className="font-medium">
        {formatRentalPeriod(period.start, period.end, { timezone, locale })}
      </span>
      <span className="text-muted-foreground"> · {duration}</span>
    </p>
  );
};
