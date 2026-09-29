import { cache, Suspense } from "react";

import { redirect } from "next/navigation";

import { Skeleton } from "@louez/ui";

import { RevenueHero } from "@/app/(dashboard)/dashboard/analytics/sales/revenue-hero";
import { RentalActivitySection } from "@/app/(dashboard)/dashboard/analytics/sales/rental-activity-section";
import { SalesAnalyticsContent } from "@/app/(dashboard)/dashboard/analytics/sales/sales-analytics-content";
import { SalesStatStripContent } from "@/app/(dashboard)/dashboard/analytics/sales/sales-stat-strip-content";
import { StatStrip } from "@/app/(dashboard)/dashboard/analytics/sales/stat-strip";

import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import { getCurrentStore } from "@/lib/store-context";

import { parsePeriod } from "../period";
import { getSalesWindow, type SalesWindow } from "./util.sales-window";
import { RevenueChart } from "../revenue-chart";
import { TopProductsTable } from "../top-products-table";
import { PaymentMethodsBreakdown } from "./payment-methods-breakdown";
import {
  getSalesPaymentStats,
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
const getPeriodPaymentStats = cache((storeId: string, window: SalesWindow) =>
  getSalesPaymentStats(storeId, window),
);

async function RevenueHeroSection({ storeId, window }: { storeId: string; window: SalesWindow }) {
  const { intl: formatLocale } = await getRequestFormatLocale();
  const stats = await getPeriodPaymentStats(storeId, window);
  return <RevenueHero stats={stats} window={window} formatLocale={formatLocale} />;
}

function RevenueHeroSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-56" />
    </div>
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

async function SalesStatStrip({ storeId, window }: { storeId: string; window: SalesWindow }) {
  const { intl: formatLocale } = await getRequestFormatLocale();
  const [reservationStats, duration, payments] = await Promise.all([
    getPeriodReservationStats(storeId, window),
    getAverageRentalDuration(storeId, window),
    getPeriodPaymentStats(storeId, window),
  ]);

  return (
    <SalesStatStripContent
      reservationStats={reservationStats}
      duration={duration}
      totalRevenue={payments.totalRevenue}
      formatLocale={formatLocale}
    />
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

async function RentalActivityData({
  storeId,
  window,
}: {
  storeId: string;
  window: SalesWindow;
}) {
  const { intl: formatLocale } = await getRequestFormatLocale();
  const [occupancy, upcoming] = await Promise.all([
    getOccupancyStats(storeId, window),
    getUpcomingRevenue(storeId, window.end),
  ]);

  return (
    <RentalActivitySection occupancy={occupancy} upcoming={upcoming} formatLocale={formatLocale} />
  );
}

async function RevenueChartSection({ storeId, window }: { storeId: string; window: SalesWindow }) {
  const { dateFns } = await getRequestFormatLocale();
  const data = await getRevenueTimeSeries(storeId, window, dateFns);
  return <RevenueChart data={data} />;
}

async function PaymentMethodsSection({
  storeId,
  window,
}: {
  storeId: string;
  window: SalesWindow;
}) {
  const data = await getRevenueByPaymentMethod(storeId, window);
  return <PaymentMethodsBreakdown data={data} />;
}

async function TopProductsByRevenueSection({
  storeId,
  window,
}: {
  storeId: string;
  window: SalesWindow;
}) {
  const {
    products,
    catalogRevenue,
    totalRevenue,
    nonCatalogRevenue,
    unallocatedRevenue,
    productCount,
  } = await getTopProductsByRevenue(storeId, window);

  return (
    <TopProductsTable
      products={products}
      catalogRevenue={catalogRevenue}
      totalRevenue={totalRevenue}
      nonCatalogRevenue={nonCatalogRevenue}
      unallocatedRevenue={unallocatedRevenue}
      productCount={productCount}
    />
  );
}

async function TopCustomersByRevenueSection({
  storeId,
  window,
}: {
  storeId: string;
  window: SalesWindow;
}) {
  const customers = await getTopCustomersByRevenue(storeId, window);
  return <TopCustomersTable customers={customers} />;
}

export default async function SalesAnalyticsPage({ searchParams }: SalesAnalyticsPageProps) {
  const store = await getCurrentStore();
  const { period: periodParam } = await searchParams;
  const period = parsePeriod(periodParam);

  if (!store) {
    redirect("/onboarding");
  }

  const window = getSalesWindow(period, new Date(), store.settings?.timezone || "UTC");

  return (
    <SalesAnalyticsContent
      revenueHero={
        <Suspense fallback={<RevenueHeroSkeleton />}>
          <RevenueHeroSection storeId={store.id} window={window} />
        </Suspense>
      }
      revenueChart={
        <Suspense fallback={<Skeleton className="h-64 w-full sm:h-72" />}>
          <RevenueChartSection storeId={store.id} window={window} />
        </Suspense>
      }
      paymentMethods={
        <Suspense fallback={<Skeleton className="h-50 w-full" />}>
          <PaymentMethodsSection storeId={store.id} window={window} />
        </Suspense>
      }
      stats={
        <Suspense fallback={<StatStripSkeleton />}>
          <SalesStatStrip storeId={store.id} window={window} />
        </Suspense>
      }
      rentalActivity={
        <Suspense fallback={<RentalActivitySkeleton />}>
          <RentalActivityData storeId={store.id} window={window} />
        </Suspense>
      }
      topProducts={
        <Suspense fallback={<Skeleton className="h-75 w-full" />}>
          <TopProductsByRevenueSection storeId={store.id} window={window} />
        </Suspense>
      }
      topCustomers={
        <Suspense fallback={<Skeleton className="h-75 w-full" />}>
          <TopCustomersByRevenueSection storeId={store.id} window={window} />
        </Suspense>
      }
    />
  );
}
