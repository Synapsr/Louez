import { Suspense } from "react";

import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { Skeleton } from "@louez/ui";
import {
  CartSolidIcon,
  ChartColumnIcon,
  EyeIcon,
  MonitorIcon,
  ParticipantsSolidIcon,
  ProductSolidIcon,
  TrendingUpSolidIcon,
} from "@louez/ui/icons";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { DashboardStatCard } from "@/components/dashboard/shared/dashboard-stat-card";

import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import { getCurrentStore } from "@/lib/store-context";

import { DeviceBreakdown } from "../device-breakdown";
import { FunnelChart, type FunnelStep } from "../funnel-chart";
import { parsePeriod, type Period } from "../period";
import { STATS_GRID_CLASS_NAME, StatsGridSkeleton } from "../stats-grid";
import { TopProductsAnalytics } from "../top-products-analytics";
import { TrendChart } from "../trend-chart";
import { getRawEventStats, getTopProductsByViews, getTrafficStats, getTrendData } from "./queries";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface TrafficAnalyticsPageProps {
  searchParams: Promise<{ period?: string }>;
}

async function TrafficStatsSection({ storeId, period }: { storeId: string; period: Period }) {
  const t = await getTranslations("dashboard.analytics");

  // Try aggregated stats first, fallback to raw events
  let stats = await getTrafficStats(storeId, period);

  // If no aggregated data, try raw events
  // Note: MySQL returns strings for aggregated values, so use Number() for comparison
  if (Number(stats.visitors) === 0 && Number(stats.productViews) === 0) {
    stats = await getRawEventStats(storeId, period);
  }

  return (
    <div className={STATS_GRID_CLASS_NAME}>
      <DashboardStatCard
        title={t("visitors")}
        value={stats.visitors.toLocaleString()}
        icon={ParticipantsSolidIcon}
        accent="progress"
        trend={stats.visitorsChange}
        subtitle={t("vsPreviousPeriod")}
      />
      <DashboardStatCard
        title={t("productViews")}
        value={stats.productViews.toLocaleString()}
        icon={EyeIcon}
        accent="submitted"
        trend={stats.viewsChange}
        subtitle={t("vsPreviousPeriod")}
      />
      <DashboardStatCard
        title={t("conversionRate")}
        value={`${stats.conversionRate.toFixed(1)}%`}
        icon={CartSolidIcon}
        accent="success"
        trend={stats.conversionRateChange}
        subtitle={t("vsPreviousPeriod")}
      />
      <DashboardStatCard
        title={t("conversions")}
        value={stats.conversions.toLocaleString()}
        icon={TrendingUpSolidIcon}
        accent="pending"
        trend={stats.conversionsChange}
        subtitle={t("vsPreviousPeriod")}
      />
    </div>
  );
}

async function TrendChartSection({ storeId, period }: { storeId: string; period: Period }) {
  const { dateFns } = await getRequestFormatLocale();
  const data = await getTrendData(storeId, period, dateFns);
  return <TrendChart data={data} />;
}

async function FunnelSection({ storeId, period }: { storeId: string; period: Period }) {
  const t = await getTranslations("dashboard.analytics");
  let stats = await getTrafficStats(storeId, period);

  if (stats.visitors === 0) {
    stats = await getRawEventStats(storeId, period);
  }

  // Translate funnel labels
  const funnel: FunnelStep[] = [
    { label: t("funnel.visitors"), value: stats.funnel[0]?.value || 0 },
    { label: t("funnel.productViews"), value: stats.funnel[1]?.value || 0 },
    { label: t("funnel.cartAdditions"), value: stats.funnel[2]?.value || 0 },
    { label: t("funnel.orders"), value: stats.funnel[3]?.value || 0 },
  ];

  return <FunnelChart steps={funnel} />;
}

async function DeviceSection({ storeId, period }: { storeId: string; period: Period }) {
  let stats = await getTrafficStats(storeId, period);

  if (stats.visitors === 0) {
    stats = await getRawEventStats(storeId, period);
  }

  return <DeviceBreakdown data={stats.devices} />;
}

async function TopProductsByViewsSection({ storeId, period }: { storeId: string; period: Period }) {
  const products = await getTopProductsByViews(storeId, period);
  return <TopProductsAnalytics products={products} />;
}

export default async function TrafficAnalyticsPage({ searchParams }: TrafficAnalyticsPageProps) {
  const t = await getTranslations("dashboard.analytics");
  const store = await getCurrentStore();
  const { period: periodParam } = await searchParams;
  const period = parsePeriod(periodParam);

  if (!store) {
    redirect("/onboarding");
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Suspense fallback={<StatsGridSkeleton />}>
        <TrafficStatsSection storeId={store.id} period={period} />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardSectionCard
          title={t("trafficTrend")}
          description={t("trafficTrendDescription")}
          icon={ChartColumnIcon}
          accent="progress"
          className="lg:col-span-2"
        >
          <Suspense fallback={<Skeleton className="h-64 w-full sm:h-80" />}>
            <TrendChartSection storeId={store.id} period={period} />
          </Suspense>
        </DashboardSectionCard>

        <DashboardSectionCard
          title={t("conversionFunnel")}
          description={t("conversionFunnelDescription")}
          icon={CartSolidIcon}
          accent="submitted"
        >
          <Suspense fallback={<Skeleton className="h-70 w-full" />}>
            <FunnelSection storeId={store.id} period={period} />
          </Suspense>
        </DashboardSectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardSectionCard
          title={t("topProducts")}
          description={t("topProductsDescription")}
          icon={ProductSolidIcon}
          accent="success"
          className="lg:col-span-2"
        >
          <Suspense fallback={<Skeleton className="h-75 w-full" />}>
            <TopProductsByViewsSection storeId={store.id} period={period} />
          </Suspense>
        </DashboardSectionCard>

        <DashboardSectionCard
          title={t("devices")}
          description={t("devicesDescription")}
          icon={MonitorIcon}
          accent="neutral"
        >
          <Suspense fallback={<Skeleton className="h-50 w-full" />}>
            <DeviceSection storeId={store.id} period={period} />
          </Suspense>
        </DashboardSectionCard>
      </div>
    </div>
  );
}
