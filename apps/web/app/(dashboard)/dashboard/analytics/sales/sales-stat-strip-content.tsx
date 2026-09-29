"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@louez/utils";
import { StatStrip } from "@/app/(dashboard)/dashboard/analytics/sales/stat-strip";
import { StatStripItem } from "@/app/(dashboard)/dashboard/analytics/sales/stat-strip-item";
import type {
  AverageRentalDurationStats,
  PeriodReservationStats,
} from "@/app/(dashboard)/dashboard/analytics/sales/rental-queries";

/** Below two days a rental reads better in hours than in fractions of a day. */
const DURATION_DAYS_THRESHOLD_HOURS = 48;

interface SalesStatStripContentProps {
  reservationStats: PeriodReservationStats;
  duration: AverageRentalDurationStats;
  totalRevenue: number;
  formatLocale: string;
}

export const SalesStatStripContent = ({
  reservationStats,
  duration,
  totalRevenue,
  formatLocale,
}: SalesStatStripContentProps) => {
  const t = useTranslations("dashboard.statistics");
  const avgHours = duration.avgMinutes === null ? null : duration.avgMinutes / 60;

  return (
    <StatStrip>
      <StatStripItem
        label={t("reservations")}
        value={reservationStats.reservationCount}
        trend={reservationStats.growth}
        subtitle={reservationStats.growth === null ? t("noData") : t("vsLastPeriod")}
      />
      <StatStripItem
        label={t("avgRentalDuration")}
        value={
          avgHours === null
            ? "—"
            : avgHours >= DURATION_DAYS_THRESHOLD_HOURS
              ? t("durationDays", { days: avgHours / 24 })
              : t("durationHours", { hours: Math.round(avgHours) })
        }
        subtitle={t("onReservations", { count: duration.reservationCount })}
      />
      <StatStripItem
        label={t("totalRevenue")}
        value={formatCurrency(totalRevenue, "EUR", formatLocale)}
        subtitle={t("sinceBeginning")}
      />
    </StatStrip>
  );
};
