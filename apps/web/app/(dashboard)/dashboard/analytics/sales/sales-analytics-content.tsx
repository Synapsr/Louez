"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  CalendarSolidIcon,
  ChartColumnIcon,
  CreditCardSolidIcon,
  ParticipantsSolidIcon,
  ProductSolidIcon,
} from "@louez/ui/icons";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";

interface SalesAnalyticsContentProps {
  revenueHero: ReactNode;
  revenueChart: ReactNode;
  paymentMethods: ReactNode;
  stats: ReactNode;
  rentalActivity: ReactNode;
  topProducts: ReactNode;
  topCustomers: ReactNode;
}

export const SalesAnalyticsContent = ({
  revenueHero,
  revenueChart,
  paymentMethods,
  stats,
  rentalActivity,
  topProducts,
  topCustomers,
}: SalesAnalyticsContentProps) => {
  const t = useTranslations("dashboard.statistics");
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
          {revenueHero}

          {revenueChart}
        </DashboardSectionCard>

        <DashboardSectionCard
          title={t("paymentMethods.title")}
          description={t("paymentMethods.description")}
          icon={CreditCardSolidIcon}
          accent="primary"
        >
          {paymentMethods}
        </DashboardSectionCard>
      </div>

      {stats}

      <DashboardSectionCard title={t("rentalActivity")} icon={CalendarSolidIcon} accent="progress">
        {rentalActivity}
      </DashboardSectionCard>

      <DashboardSectionCard
        title={t("topProducts.title")}
        description={t("topProducts.description")}
        icon={ProductSolidIcon}
        accent="submitted"
      >
        {topProducts}
      </DashboardSectionCard>

      <DashboardSectionCard
        title={t("topCustomers.title")}
        description={t("topCustomers.description")}
        icon={ParticipantsSolidIcon}
        accent="progress"
      >
        {topCustomers}
      </DashboardSectionCard>
    </div>
  );
};
