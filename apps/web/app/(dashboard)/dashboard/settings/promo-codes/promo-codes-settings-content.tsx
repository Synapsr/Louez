"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { PromoCodesManager } from "@/app/(dashboard)/dashboard/settings/promo-codes/promo-codes-manager";

export const PromoCodesSettingsContent = ({
  codes,
  currency,
  readOnly,
}: ComponentProps<typeof PromoCodesManager>) => {
  const t = useTranslations("dashboard.settings");
  return (
    <SettingsPageShell title={t("promoCodes.title")} description={t("promoCodes.description")}>
      <PromoCodesManager codes={codes} currency={currency} readOnly={readOnly} />
    </SettingsPageShell>
  );
};
