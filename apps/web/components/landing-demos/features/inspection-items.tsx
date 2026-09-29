"use client";

import { useTranslations } from "next-intl";

import { InspectionWizard } from "@/app/(dashboard)/dashboard/reservations/[id]/inspection/[type]/components/inspection-wizard";
import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";
import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoInspectionWizard } from "@/lib/landing-demos/inspections";

export const InspectionItemsScene = (_props: FeatureSceneProps) => {
  const t = useTranslations("dashboard.settings.inspection");
  const wizard = createDemoInspectionWizard(useDemoLocale(), 1);
  return (
    <DashboardSceneFrame
      page="reservations"
      pages={["reservations"]}
      pathname="/dashboard/reservations/demo-reservation-0/inspection/departure"
    >
      <DashboardBreadcrumbLabel
        pathname="/dashboard/reservations/demo-reservation-0"
        label="#1042"
      />
      <DashboardBreadcrumbLabel label={t("wizard.departureInspection")} />
      <InspectionWizard {...wizard} initialStep="items" />
    </DashboardSceneFrame>
  );
};
