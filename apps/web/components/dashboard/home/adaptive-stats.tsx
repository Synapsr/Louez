"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  CalendarSolidIcon,
  ClockSolidIcon,
  CreditCardSolidIcon,
  ParticipantsSolidIcon,
  ProductSolidIcon,
} from "@louez/ui/icons";
import { formatCurrency } from "@louez/utils";

import { DashboardStatCard } from "@/components/dashboard/shared/dashboard-stat-card";
import { useStoreCurrency } from "@/contexts/store-context";
import type { StoreMetrics, StoreState } from "./home-types";
import { calculateGrowth } from "./home-utils";
import { ReservationCalendarPrefetchBoundary } from "./reservation-calendar-prefetch-boundary";

interface AdaptiveStatsProps {
  metrics: StoreMetrics;
  storeState: StoreState;
}

/** Two columns on phones, one row of four from `lg` — same rhythm everywhere. */
const GRID_CLASS_NAME = "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4";
const TODAY_DEPARTURES_HREF =
  "/dashboard/reservations?restorePreferredView=true&date=today&period=today&operation=departure&status=confirmed&statuses=confirmed";
const TODAY_RETURNS_HREF =
  "/dashboard/reservations?restorePreferredView=true&date=today&period=today&operation=return&status=ongoing&statuses=ongoing";

export const AdaptiveStats = ({ metrics, storeState }: AdaptiveStatsProps) => {
  const t = useTranslations("dashboard.home");
  const currency = useStoreCurrency();

  // Catalog-focused stats while the store is still being set up.
  if (storeState === "virgin" || storeState === "building") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <DashboardStatCard
          title={t("stats.products")}
          value={metrics.activeProductCount}
          icon={ProductSolidIcon}
          accent="submitted"
          href="/dashboard/products"
          subtitle={
            metrics.draftProductCount > 0
              ? t("stats.drafts", { count: metrics.draftProductCount })
              : undefined
          }
        />
        <DashboardStatCard
          title={t("stats.customers")}
          value={metrics.customerCount}
          icon={ParticipantsSolidIcon}
          accent="progress"
          href="/dashboard/customers"
        />
      </div>
    );
  }

  if (storeState === "starting") {
    return (
      <div className={GRID_CLASS_NAME}>
        <ReservationCalendarPrefetchBoundary href={TODAY_DEPARTURES_HREF}>
          <DashboardStatCard
            title={t("stats.todaysDepartures")}
            value={metrics.todaysDepartures}
            icon={ArrowUpRight}
            accent="success"
            href={TODAY_DEPARTURES_HREF}
            subtitle={t("stats.toDeliver")}
          />
        </ReservationCalendarPrefetchBoundary>
        <ReservationCalendarPrefetchBoundary href={TODAY_RETURNS_HREF}>
          <DashboardStatCard
            title={t("stats.todaysReturns")}
            value={metrics.todaysReturns}
            icon={ArrowDownRight}
            accent="progress"
            href={TODAY_RETURNS_HREF}
            subtitle={t("stats.toRecover")}
          />
        </ReservationCalendarPrefetchBoundary>
        <DashboardStatCard
          title={t("stats.pendingRequests")}
          value={metrics.pendingReservations}
          icon={ClockSolidIcon}
          accent="pending"
          href="/dashboard/reservations?status=pending"
          badge={metrics.pendingReservations > 0 ? t("stats.toProcess") : undefined}
        />
        <DashboardStatCard
          title={t("stats.totalReservations")}
          value={metrics.totalReservations}
          icon={CalendarSolidIcon}
          accent="neutral"
          href="/dashboard/reservations"
          subtitle={t("stats.completed", { count: metrics.completedReservations })}
        />
      </div>
    );
  }

  const revenueGrowth = calculateGrowth(metrics.monthlyRevenue, metrics.lastMonthRevenue);

  return (
    <div className={GRID_CLASS_NAME}>
      <ReservationCalendarPrefetchBoundary href={TODAY_DEPARTURES_HREF}>
        <DashboardStatCard
          title={t("stats.todaysDepartures")}
          value={metrics.todaysDepartures}
          icon={ArrowUpRight}
          accent="success"
          href={TODAY_DEPARTURES_HREF}
          subtitle={t("stats.toDeliver")}
        />
      </ReservationCalendarPrefetchBoundary>
      <ReservationCalendarPrefetchBoundary href={TODAY_RETURNS_HREF}>
        <DashboardStatCard
          title={t("stats.todaysReturns")}
          value={metrics.todaysReturns}
          icon={ArrowDownRight}
          accent="progress"
          href={TODAY_RETURNS_HREF}
          subtitle={t("stats.toRecover")}
        />
      </ReservationCalendarPrefetchBoundary>
      <DashboardStatCard
        title={t("stats.pendingRequests")}
        value={metrics.pendingReservations}
        icon={ClockSolidIcon}
        accent="pending"
        href="/dashboard/reservations?status=pending"
        badge={metrics.pendingReservations > 0 ? t("stats.toProcess") : undefined}
      />
      <DashboardStatCard
        title={t("stats.monthlyRevenue")}
        value={formatCurrency(metrics.monthlyRevenue, currency)}
        icon={CreditCardSolidIcon}
        accent="submitted"
        href="/dashboard/analytics/sales"
        trend={revenueGrowth}
        subtitle={t("stats.vsLastMonth")}
      />
    </div>
  );
};
