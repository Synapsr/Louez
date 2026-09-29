"use client";

import { useTranslations } from "next-intl";
import { cn, formatCurrency } from "@louez/utils";
import { DASHBOARD_ACCENT_FILL } from "@/components/dashboard/shared/dashboard-accent";
import type {
  OccupancyStats,
  UpcomingRevenueStats,
} from "@/app/(dashboard)/dashboard/analytics/sales/rental-queries";

interface RentalActivitySectionProps {
  occupancy: OccupancyStats;
  upcoming: UpcomingRevenueStats;
  formatLocale: string;
}

export const RentalActivitySection = ({
  occupancy,
  upcoming,
  formatLocale,
}: RentalActivitySectionProps) => {
  const t = useTranslations("dashboard.statistics");
  return (
    <div data-demo-target="analytics-occupancy" className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{t("occupancyRate")}</span>
          <span className="text-sm font-semibold tabular-nums">{occupancy.rate.toFixed(1)}%</span>
        </div>
        <div className="bg-muted h-2.5 w-full overflow-hidden rounded-full">
          <div
            className={cn("h-full transition-all duration-500", DASHBOARD_ACCENT_FILL.progress)}
            style={{ width: `${Math.min(occupancy.rate, 100)}%` }}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {t("occupancySubtitle", { count: occupancy.availableUnits })}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-5">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("upcomingRevenue")}</p>
          <p className="text-muted-foreground text-xs">
            {t("upcomingRevenueCount", { count: upcoming.reservationCount })}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {formatCurrency(upcoming.revenue, "EUR", formatLocale)}
        </span>
      </div>
    </div>
  );
};
