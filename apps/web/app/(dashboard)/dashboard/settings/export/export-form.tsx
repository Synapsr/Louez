"use client";

import { useTranslations } from "next-intl";

import { CalendarCheckIcon, PricingIcon, ProductIcon, UsersIcon } from "@louez/ui/icons";

import { ContractExportCard } from "./contract-export-card";
import { TabularExportCard } from "./tabular-export-card";

interface ExportFormProps {
  timezone?: string;
}

export const ExportForm = ({ timezone }: ExportFormProps) => {
  const t = useTranslations("dashboard.settings.export");

  return (
    <div className="space-y-6">
      <ContractExportCard timezone={timezone} />

      <TabularExportCard
        type="payments"
        icon={PricingIcon}
        title={t("payments.title")}
        description={t("payments.description")}
        buttonLabel={t("payments.button")}
        showDateRange
        timezone={timezone}
      />

      <TabularExportCard
        type="reservations"
        icon={CalendarCheckIcon}
        title={t("reservations.title")}
        description={t("reservations.description")}
        buttonLabel={t("reservations.button")}
        showDateRange
        timezone={timezone}
      />

      <TabularExportCard
        type="products"
        icon={ProductIcon}
        title={t("products.title")}
        description={t("products.description")}
        buttonLabel={t("products.button")}
        showDateRange={false}
        timezone={timezone}
      />

      <TabularExportCard
        type="customers"
        icon={UsersIcon}
        title={t("customers.title")}
        description={t("customers.description")}
        buttonLabel={t("customers.button")}
        showDateRange
        dateRangeOptional
        dateRangeHint={t("customers.dateRangeHint")}
        sensitiveOptIn={{
          label: t("customers.includeSensitive"),
          warning: t("customers.includeSensitiveWarning"),
        }}
        timezone={timezone}
      />
    </div>
  );
};
