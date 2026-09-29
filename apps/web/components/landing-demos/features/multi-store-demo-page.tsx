"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { AggregateStats } from "@/app/multi-store/_components/aggregate-stats";
import { MultiStoreHeader } from "@/app/multi-store/_components/header";
import { MultiStorePageShell } from "@/app/multi-store/_components/multi-store-page-shell";
import { MultiStorePeriodFilter, type Period } from "@/app/multi-store/_components/period-filter";
import { PlanLimitsAlert } from "@/app/multi-store/_components/plan-limits-alert";
import { StoresRevenueChart } from "@/app/multi-store/_components/stores-revenue-chart";
import { StoresTable } from "@/app/multi-store/_components/stores-table";
import { MultiStoreLayoutView } from "@/app/multi-store/multi-store-layout-view";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoMultiStoreData, DEMO_MULTI_STORES } from "@/lib/landing-demos/multi-store";

export const MultiStoreDemoPage = ({
  period,
  showChart = false,
}: Pick<FeatureSceneProps, "period"> & { showChart?: boolean }) => {
  const t = useTranslations("dashboard.multiStore");
  const tAnalytics = useTranslations("dashboard.analytics");
  const locale = useDemoLocale();
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("30d");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fixtures = useMemo(
    () => createDemoMultiStoreData(period, selectedPeriod, locale),
    [period, selectedPeriod, locale],
  );

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && showChart) scroller.scrollTop = scroller.scrollHeight;
  }, [showChart]);

  return (
    <div
      ref={scrollRef}
      data-dashboard-content
      data-demo-target="multi-store-scroll"
      className="h-svh overflow-y-auto overscroll-contain"
    >
      <MultiStoreLayoutView
        header={
          <MultiStoreHeader
            stores={DEMO_MULTI_STORES}
            userEmail="camille@maisonduvelo.example"
            readOnly
          />
        }
      >
        <MultiStorePageShell
          title={t("title")}
          description={t("description", { count: DEMO_MULTI_STORES.length })}
          periodFilter={
            <MultiStorePeriodFilter value={selectedPeriod} onChange={setSelectedPeriod} />
          }
        >
          <div data-demo-target="multi-store-totals">
            <AggregateStats
              metrics={fixtures.metrics}
              translations={{
                totalRevenue: t("stats.totalRevenue"),
                reservations: t("stats.reservations"),
                pending: t("stats.pending"),
                customers: t("stats.customers"),
                newCustomers: t("stats.newCustomers"),
              }}
              vsPreviousPeriod={tAnalytics("vsPreviousPeriod")}
            />
          </div>
          <PlanLimitsAlert
            limits={fixtures.limits}
            translations={{
              title: t("limits.title"),
              description: t("limits.description", { count: fixtures.limits.length }),
              products: t("limits.products"),
              reservationsPerMonth: t("limits.reservations"),
              customers: t("limits.customers"),
              upgrade: t("limits.upgrade"),
            }}
          />
          <StoresTable
            stores={fixtures.performance}
            readOnly
            translations={{
              title: t("table.title"),
              store: t("table.store"),
              plan: t("table.plan"),
              revenue: t("table.revenue"),
              change: t("table.change"),
              reservations: t("table.reservations"),
              pending: t("stats.pending"),
              customers: t("table.customers"),
              goToStore: t("table.goToStore"),
            }}
          />
          <div data-demo-target="multi-store-chart">
            <StoresRevenueChart
              data={fixtures.data}
              storeNames={fixtures.storeNames}
              translations={{ title: t("chart.title"), description: t("chart.description") }}
              emptyMessage={t("empty.description")}
            />
          </div>
        </MultiStorePageShell>
      </MultiStoreLayoutView>
    </div>
  );
};
