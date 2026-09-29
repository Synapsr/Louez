"use client";

import { useTranslations } from "next-intl";

export const CustomersPageHeading = () => {
  const t = useTranslations("dashboard.customers");
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>
    </div>
  );
};
