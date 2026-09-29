"use client";

import { useMemo, useState } from "react";

import { AnalyticsLayoutContent } from "@/app/(dashboard)/dashboard/analytics/analytics-layout-content";
import type { Period } from "@/app/(dashboard)/dashboard/analytics/period";
import { RevenueChart } from "@/app/(dashboard)/dashboard/analytics/revenue-chart";
import { PaymentMethodsBreakdown } from "@/app/(dashboard)/dashboard/analytics/sales/payment-methods-breakdown";
import { RentalActivitySection } from "@/app/(dashboard)/dashboard/analytics/sales/rental-activity-section";
import { RevenueHero } from "@/app/(dashboard)/dashboard/analytics/sales/revenue-hero";
import { SalesAnalyticsContent } from "@/app/(dashboard)/dashboard/analytics/sales/sales-analytics-content";
import { SalesStatStripContent } from "@/app/(dashboard)/dashboard/analytics/sales/sales-stat-strip-content";
import { TopCustomersTable } from "@/app/(dashboard)/dashboard/analytics/sales/top-customers-table";
import { TopProductsTable } from "@/app/(dashboard)/dashboard/analytics/top-products-table";
import { UnifiedPeriodFilter } from "@/app/(dashboard)/dashboard/analytics/unified-period-filter";
import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { resolveFormatLocale } from "@/lib/i18n/format-locale";
import { createDemoAnalytics } from "@/lib/landing-demos/analytics";

export const AnalyticsDemoPage = ({ period }: Pick<FeatureSceneProps, "period">) => {
  const locale = useDemoLocale();
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("30d");
  const data = useMemo(
    () => createDemoAnalytics(selectedPeriod, locale, period),
    [selectedPeriod, locale, period],
  );
  const { intl: formatLocale } = resolveFormatLocale(locale);

  return (
    <DashboardSceneFrame
      page="analytics"
      pages={["analytics"]}
      pathname="/dashboard/analytics/sales"
    >
      <AnalyticsLayoutContent
        periodFilter={
          <UnifiedPeriodFilter
            className="shrink-0"
            period={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
          />
        }
      >
        <SalesAnalyticsContent
          revenueHero={
            <RevenueHero stats={data.stats} window={data.window} formatLocale={formatLocale} />
          }
          revenueChart={
            <RevenueChart data={data.revenue} initialDimension={{ width: 640, height: 288 }} />
          }
          paymentMethods={<PaymentMethodsBreakdown data={data.methods} />}
          stats={
            <SalesStatStripContent
              reservationStats={data.reservationStats}
              duration={data.duration}
              totalRevenue={data.stats.totalRevenue}
              formatLocale={formatLocale}
            />
          }
          rentalActivity={
            <RentalActivitySection
              occupancy={data.occupancy}
              upcoming={data.upcoming}
              formatLocale={formatLocale}
            />
          }
          topProducts={<TopProductsTable {...data.topProducts} readOnly />}
          topCustomers={<TopCustomersTable customers={data.customers} readOnly />}
        />
      </AnalyticsLayoutContent>
    </DashboardSceneFrame>
  );
};
