"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
export const ReservationsPageHeading = ({ actions }: { actions: ReactNode }) => {
  const t = useTranslations("dashboard.reservations");
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="hidden sm:block">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1 sm:gap-2">{actions}</div>
    </div>
  );
};
