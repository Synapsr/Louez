"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

interface FinancesHeaderProps {
  /** Period control and export menu. */
  actions: ReactNode;
}

export const FinancesHeader = ({ actions }: FinancesHeaderProps) => {
  const t = useTranslations("dashboard.finances");

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm sm:text-base">{t("description")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end print:hidden">
        {actions}
      </div>
    </div>
  );
};
