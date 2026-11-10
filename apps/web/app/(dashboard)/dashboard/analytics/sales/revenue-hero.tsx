"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@louez/utils";
import { DashboardTrendBadge } from "@/components/dashboard/shared/dashboard-trend-badge";
import type { getSalesPaymentStats } from "@louez/api/services/sales-analytics";
import type { SalesWindow } from "@louez/api/services/sales-window";

interface RevenueHeroProps {
  stats: Awaited<ReturnType<typeof getSalesPaymentStats>>;
  window: SalesWindow;
  /** The store's current currency, the one these figures are counted in. */
  currency: string;
  formatLocale: string;
}

export const RevenueHero = ({ stats, window, currency, formatLocale }: RevenueHeroProps) => {
  const t = useTranslations("dashboard.statistics");
  const periodDateFormat = new Intl.DateTimeFormat(formatLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: window.timezone,
  });

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-2xl leading-tight font-bold tracking-tight tabular-nums sm:text-3xl">
          {formatCurrency(stats.periodRevenue, currency, formatLocale)}
        </span>
        <DashboardTrendBadge trend={stats.revenueGrowth} />
        {stats.revenueGrowth !== null && (
          <span className="text-muted-foreground text-xs">{t("vsLastPeriod")}</span>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {periodDateFormat.format(window.start)} – {periodDateFormat.format(window.end)} (
        {window.timezone})
      </p>
      <p className="text-muted-foreground text-sm">
        {t("paymentsCount", { count: stats.periodPaymentCount })} ·{" "}
        {t("avgPaymentInline", {
          amount: formatCurrency(stats.avgPaymentValue, currency, formatLocale),
        })}
      </p>
    </div>
  );
};
