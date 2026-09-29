"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { DeliverySettingsForm } from "./delivery-settings-form";

export const DeliverySettingsContent = ({
  store,
  hasCoordinates,
  locations,
  readOnly,
  addressTestingEnabled,
}: ComponentProps<typeof DeliverySettingsForm>) => {
  const t = useTranslations("dashboard.settings.delivery");

  return (
    <SettingsPageShell title={t("title")} description={t("description")}>
      <DeliverySettingsForm
        store={store}
        hasCoordinates={hasCoordinates}
        locations={locations}
        readOnly={readOnly}
        addressTestingEnabled={addressTestingEnabled}
      />
    </SettingsPageShell>
  );
};
