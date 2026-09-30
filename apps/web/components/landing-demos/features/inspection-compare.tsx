"use client";

import { useTranslations } from "next-intl";

import { ComparisonView } from "@/app/(dashboard)/dashboard/reservations/[id]/inspection/compare/comparison-view";
import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";
import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoInspectionComparison } from "@/lib/landing-demos/inspections";

export const InspectionCompareScene = ({ period }: FeatureSceneProps) => {
  const t = useTranslations("dashboard.settings.inspection");
  const comparison = createDemoInspectionComparison(period, useDemoLocale());
  return (
    <DashboardSceneFrame
      page="reservations"
      pages={["reservations"]}
      pathname="/dashboard/reservations/demo-reservation-0/inspection/compare"
    >
      <DashboardBreadcrumbLabel
        pathname="/dashboard/reservations/demo-reservation-0"
        label="#1042"
      />
      <DashboardBreadcrumbLabel label={t("comparison.title")} />
      <ComparisonView {...comparison} />
    </DashboardSceneFrame>
  );
};
