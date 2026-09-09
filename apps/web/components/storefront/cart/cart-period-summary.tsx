"use client";

import { useLocale, useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import type { CartPeriod } from "@/contexts/cart-context";
import { useStoreTimezone } from "@/contexts/store-context";
import { formatDetailedDuration } from "@/lib/utils/duration";
import { formatRentalPeriod } from "@/lib/utils/store-date";

interface CartPeriodSummaryProps {
  period: CartPeriod | null;
  className?: string;
}

const toPeriodValue = (period: CartPeriod): { start: Date; end: Date } | null => {
  const start = new Date(period.startDate);
  const end = new Date(period.endDate);
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? null : { start, end };
};

/**
 * The cart's rental period, stated rather than offered: the dates on one
 * side, how long they add up to on the other. The period is picked in the
 * catalogue and on the product page, so a control here would be a third
 * entry point for something the cart only reports. Nothing is rendered
 * without a period.
 */
export const CartPeriodSummary = ({ period, className }: CartPeriodSummaryProps) => {
  const t = useTranslations("storefront.dateSelection");
  const locale = useLocale();
  const timezone = useStoreTimezone();
  const value = period ? toPeriodValue(period) : null;

  if (!value) {
    return null;
  }

  const duration = formatDetailedDuration(value.start, value.end, {
    day: t("durationDay"),
    days: t("durationDays"),
    and: t("and"),
  });

  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-2xl bg-muted px-4 py-3 text-sm",
        className,
      )}
      data-slot="cart-period-summary"
    >
      <span className="min-w-0 font-medium">
        {formatRentalPeriod(value.start, value.end, { timezone, locale, style: "long" })}
      </span>
      <span className="shrink-0 text-muted-foreground">{duration}</span>
    </div>
  );
};
