import { cache, Suspense, type ReactNode } from "react";

import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { Card, CardPanel, Skeleton } from "@louez/ui";
import {
  CalendarSolidIcon,
  ChartColumnIcon,
  CreditCardSolidIcon,
  ParticipantsSolidIcon,
  ProductSolidIcon,
} from "@louez/ui/icons";
import { cn, formatCurrency } from "@louez/utils";

import { DASHBOARD_ACCENT_FILL } from "@/components/dashboard/shared/dashboard-accent";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { DashboardTrendBadge } from "@/components/dashboard/shared/dashboard-trend-badge";

import { getRentalPaymentPeriodStats } from "@/lib/dashboard/metrics";
import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import { getCurrentStore } from "@/lib/store-context";

import { getPeriodConfig, parsePeriod, type Period } from "../period";
import { RevenueChart } from "../revenue-chart";
import { TopProductsTable } from "../top-products-table";
import { PaymentMethodsBreakdown } from "./payment-methods-breakdown";
import {
  getRevenueByPaymentMethod,
  getRevenueTimeSeries,
  getTopCustomersByRevenue,
  getTopProductsByRevenue,
} from "./queries";
import {
  getAverageRentalDuration,
  getOccupancyStats,
  getPeriodReservationStats,
  getUpcomingRevenue,
} from "./rental-queries";
import { TopCustomersTable } from "./top-customers-table";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface SalesAnalyticsPageProps {
  searchParams: Promise<{ period?: string }>;
}

/**
 * The hero and the stat strip sit in two Suspense boundaries but read the same
 * receipts aggregate — `cache` keeps that a single round trip per request.
 */
const getPeriodPaymentStats = cache((storeId: string, period: Period) =>
  getRentalPaymentPeriodStats({ storeId, days: getPeriodConfig(period).days }),
);

/** Below two days a rental reads better in hours than in fractions of a day. */
const DURATION_DAYS_THRESHOLD_HOURS = 48;

/** Headline receipts of the period, sitting on top of the revenue chart. */
async function RevenueHero({ storeId, period }: { storeId: string; period: Period }) {
  const t = await getTranslations("dashboard.statistics");
  const { intl: formatLocale } = await getRequestFormatLocale();
  const stats = await getPeriodPaymentStats(storeId, period);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-2xl leading-tight font-bold tracking-tight tabular-nums sm:text-3xl">
          {formatCurrency(stats.periodRevenue, "EUR", formatLocale)}
        </span>
        <DashboardTrendBadge trend={stats.revenueGrowth} />
        <span className="text-muted-foreground text-xs">{t("vsLastPeriod")}</span>
      </div>
      <p className="text-muted-foreground text-sm">
        {t("paymentsCount", { count: stats.periodPaymentCount })} ·{" "}
        {t("avgPaymentInline", { amount: formatCurrency(stats.avgPaymentValue, "EUR", formatLocale) })}
      </p>
    </div>
  );
}

function RevenueHeroSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-56" />
    </div>
  );
}

/** One segment of the stat strip — no icon, no card chrome, just the number. */
function StatStripItem({
  label,
  value,
  subtitle,
  trend,
}: {
  label: string;
  value: ReactNode;
  subtitle: string;
  trend?: number | null;
}) {
  return (
    <div className="flex flex-col gap-1 p-4 sm:p-5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-lg leading-tight font-semibold tracking-tight tabular-nums sm:text-xl">
          {value}
        </span>
        <DashboardTrendBadge trend={trend} />
      </div>
      <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
    </div>
  );
}

/** Three-up strip: stacked on phones, split by vertical rules from `sm`. */
function StatStrip({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardPanel className="grid divide-y p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {children}
      </CardPanel>
    </Card>
  );
}

function StatStripSkeleton() {
  return (
    <StatStrip>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex flex-col gap-1 p-4 sm:p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </StatStrip>
  );
}

async function SalesStatStrip({ storeId, period }: { storeId: string; period: Period }) {
  const { intl: formatLocale } = await getRequestFormatLocale();
  const t = await getTranslations("dashboard.statistics");
  const [reservationStats, duration, payments] = await Promise.all([
    getPeriodReservationStats(storeId, period),
    getAverageRentalDuration(storeId, period),
    getPeriodPaymentStats(storeId, period),
  ]);

  const avgHours = duration.avgMinutes === null ? null : duration.avgMinutes / 60;

  return (
    <StatStrip>
      <StatStripItem
        label={t("reservations")}
        value={reservationStats.reservationCount}
        trend={reservationStats.growth}
        subtitle={t("vsLastPeriod")}
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
        value={formatCurrency(payments.totalRevenue, "EUR", formatLocale)}
        subtitle={t("sinceBeginning")}
      />
    </StatStrip>
  );
}

function RentalActivitySkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-4 w-full max-w-64" />
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="border-t pt-5">
        <Skeleton className="h-9 w-full max-w-72" />
      </div>
    </div>
  );
}

async function RentalActivitySection({ storeId, period }: { storeId: string; period: Period }) {
  const { intl: formatLocale } = await getRequestFormatLocale();
  const t = await getTranslations("dashboard.statistics");
  const [occupancy, upcoming] = await Promise.all([
    getOccupancyStats(storeId, period),
    getUpcomingRevenue(storeId),
  ]);

  return (
    <div className="space-y-5">
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
}

async function RevenueChartSection({ storeId, period }: { storeId: string; period: Period }) {
  const { dateFns } = await getRequestFormatLocale();
  const data = await getRevenueTimeSeries(storeId, period, dateFns);
  return <RevenueChart data={data} />;
}

async function PaymentMethodsSection({ storeId, period }: { storeId: string; period: Period }) {
  const data = await getRevenueByPaymentMethod(storeId, period);
  return <PaymentMethodsBreakdown data={data} />;
}

async function TopProductsByRevenueSection({
  storeId,
  period,
}: {
  storeId: string;
  period: Period;
}) {
  const { products, allProductsRevenue, productCount } = await getTopProductsByRevenue(
    storeId,
    period,
  );

  return (
    <TopProductsTable
      products={products}
      allProductsRevenue={allProductsRevenue}
      productCount={productCount}
    />
  );
}

async function TopCustomersByRevenueSection({
  storeId,
  period,
}: {
  storeId: string;
  period: Period;
}) {
  const customers = await getTopCustomersByRevenue(storeId, period);
  return <TopCustomersTable customers={customers} />;
}

export default async function SalesAnalyticsPage({ searchParams }: SalesAnalyticsPageProps) {
  const t = await getTranslations("dashboard.statistics");
  const store = await getCurrentStore();
  const { period: periodParam } = await searchParams;
  const period = parsePeriod(periodParam);

  if (!store) {
    redirect("/onboarding");
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Three columns only from `xl`: at `lg` the sidebar leaves the methods
          card a ~240px column where its amounts cannot fit. */}
      <div className="grid gap-4 xl:grid-cols-3">
        <DashboardSectionCard
          title={t("revenueChart")}
          description={t("revenueChartDescription")}
          icon={ChartColumnIcon}
          accent="success"
          className="xl:col-span-2"
          contentClassName="space-y-4"
        >
          <Suspense fallback={<RevenueHeroSkeleton />}>
            <RevenueHero storeId={store.id} period={period} />
          </Suspense>

          <Suspense fallback={<Skeleton className="h-64 w-full sm:h-72" />}>
            <RevenueChartSection storeId={store.id} period={period} />
          </Suspense>
        </DashboardSectionCard>

        <DashboardSectionCard
          title={t("paymentMethods.title")}
          description={t("paymentMethods.description")}
          icon={CreditCardSolidIcon}
          accent="primary"
        >
          <Suspense fallback={<Skeleton className="h-50 w-full" />}>
            <PaymentMethodsSection storeId={store.id} period={period} />
          </Suspense>
        </DashboardSectionCard>
      </div>

      <Suspense fallback={<StatStripSkeleton />}>
        <SalesStatStrip storeId={store.id} period={period} />
      </Suspense>

      <DashboardSectionCard title={t("rentalActivity")} icon={CalendarSolidIcon} accent="progress">
        <Suspense fallback={<RentalActivitySkeleton />}>
          <RentalActivitySection storeId={store.id} period={period} />
        </Suspense>
      </DashboardSectionCard>

      <DashboardSectionCard
        title={t("topProducts.title")}
        description={t("topProducts.description")}
        icon={ProductSolidIcon}
        accent="submitted"
      >
        <Suspense fallback={<Skeleton className="h-75 w-full" />}>
          <TopProductsByRevenueSection storeId={store.id} period={period} />
        </Suspense>
      </DashboardSectionCard>

      <DashboardSectionCard
        title={t("topCustomers.title")}
        description={t("topCustomers.description")}
        icon={ParticipantsSolidIcon}
        accent="progress"
      >
        <Suspense fallback={<Skeleton className="h-75 w-full" />}>
          <TopCustomersByRevenueSection storeId={store.id} period={period} />
        </Suspense>
      </DashboardSectionCard>
    </div>
  );
}
