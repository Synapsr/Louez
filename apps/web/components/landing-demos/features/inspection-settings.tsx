"use client";

import { useTranslations } from "next-intl";

import { InspectionSettingsForm } from "@/app/(dashboard)/dashboard/settings/inspections/inspection-settings-form";
import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { SettingsSceneFrame } from "@/components/landing-demos/settings-scene-frame";
import { KeyboardShortcutsProvider } from "@/components/shared/keyboard-shortcuts-provider";
import { DEMO_INSPECTION_STORE } from "@/lib/landing-demos/inspections";

export const InspectionSettingsScene = (_props: FeatureSceneProps) => {
  const t = useTranslations("dashboard.settings");
  return (
    <KeyboardShortcutsProvider initialShortcuts={{}}>
      <SettingsSceneFrame pathname="/dashboard/settings/inspections">
        <SettingsPageShell title={t("inspection.title")} description={t("inspection.description")}>
          <InspectionSettingsForm store={DEMO_INSPECTION_STORE} readOnly />
        </SettingsPageShell>
      </SettingsSceneFrame>
    </KeyboardShortcutsProvider>
  );
};
