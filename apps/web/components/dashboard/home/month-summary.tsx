"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn, formatCurrency } from "@louez/utils";

import type { StoreMetrics } from "./home-types";
import { calculateGrowth } from "./home-utils";

/**
 * A little of the month's figures on one quiet line, once the store has
 * activity: what came in and its trend, the reservations, the customers.
 * The full picture is one click away in the analytics.
 */
export const MonthSummary = ({ metrics }: { metrics: StoreMetrics }) => {
  const t = useTranslations("dashboard.home");
  const growth = calculateGrowth(metrics.monthlyRevenue, metrics.lastMonthRevenue);

  return (
    <div className="bg-muted text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl px-4 py-2.5 text-sm">
      <span className="text-foreground font-bold">{t("month.title")}</span>
      <span>
        {t.rich("month.revenue", {
          amount: formatCurrency(metrics.monthlyRevenue),
          strong: (chunks) => <b className="text-foreground tabular-nums">{chunks}</b>,
        })}
        {growth !== null && (
          <span
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
      <span>
        {t.rich("month.reservations", {
          count: metrics.totalReservations,
          strong: (chunks) => <b className="text-foreground tabular-nums">{chunks}</b>,
        })}
      </span>
      <span>
        {t.rich("month.customers", {
          count: metrics.customerCount,
          strong: (chunks) => <b className="text-foreground tabular-nums">{chunks}</b>,
        })}
      </span>
      <Link
        href="/dashboard/analytics/sales"
        className="text-primary ms-auto inline-flex items-center gap-1 font-semibold hover:underline"
      >
        {t("month.seeAnalytics")}
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
};
