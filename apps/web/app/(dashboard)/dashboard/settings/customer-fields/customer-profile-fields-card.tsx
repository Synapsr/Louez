"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { CUSTOMER_PROFILE_FIELD_KEYS } from "@louez/types";
import { Card } from "@louez/ui";

import { customerProfileSettingsOptions } from "./customer-fields.queries";
import { CustomerProfileFieldCanvasRow } from "./customer-profile-field-canvas-row";

/**
 * "Profil": the fields Louez ships with (birth date, origin, links), edited
 * like the store's own: a click opens their settings. Hidden ones stay, greyed.
 */
export const CustomerProfileFieldsCard = () => {
  const t = useTranslations("dashboard.settings.customerFields.builder.profile");
  const { data: settings } = useQuery(customerProfileSettingsOptions());

  if (!settings) return null;

  return (
    <Card className="gap-2 p-3 sm:p-4">
      <div className="flex min-h-9 items-center ps-1">
        <h3 className="text-base font-semibold leading-snug">{t("title")}</h3>
      </div>
      <ul className="flex flex-col gap-1">
        {CUSTOMER_PROFILE_FIELD_KEYS.map((key) => (
          <CustomerProfileFieldCanvasRow key={key} field={key} settings={settings[key]} />
        ))}
      </ul>
    </Card>
  );
};
