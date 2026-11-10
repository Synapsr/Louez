"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn, formatCurrency } from "@louez/utils";

import type { StoreMetrics } from "./home-types";
import { calculateGrowth } from "./home-utils";

/**
 * The month on one quiet line beside the greeting: what came in and its
 * trend, the reservations and the new customers — this month only. The trend
 * compares with the same stretch of last month, so the 10th is never measured
 * against a full month. The full picture is one click away in the analytics.
 */
export const MonthSummary = ({
  metrics,
  className,
}: {
  metrics: StoreMetrics;
  className?: string;
}) => {
  const t = useTranslations("dashboard.home");
  const growth = calculateGrowth(metrics.monthlyRevenue, metrics.previousPeriodRevenue);
  const strong = (chunks: React.ReactNode) => (
    <b className="text-foreground font-semibold tabular-nums">{chunks}</b>
  );

  return (
    <Link
      href="/dashboard/analytics/sales"
      className={cn(
        "group text-muted-foreground hover:text-foreground inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm transition-colors",
        className,
      )}
    >
      <span className="text-foreground font-bold">{t("month.title")}</span>
      <span>
        {t.rich("month.revenue", { amount: formatCurrency(metrics.monthlyRevenue), strong })}
        {growth !== null && (
          <span
            title={t("month.growthHint")}
            className={cn(
              "ms-1.5 text-xs font-bold tabular-nums",
              growth >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {growth >= 0 ? "↗" : "↘"} {growth > 0 ? "+" : ""}
            {growth} %
          </span>
        )}
      </span>
      <span>{t.rich("month.reservations", { count: metrics.reservationsThisMonth, strong })}</span>
      <span>{t.rich("month.customers", { count: metrics.newCustomersThisMonth, strong })}</span>
      <ArrowRight
        aria-label={t("month.seeAnalytics")}
        className="text-primary size-3.5 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
};
