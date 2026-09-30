"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

interface AnalyticsLayoutContentProps {
  children: ReactNode;
  periodFilter: ReactNode;
}

export const AnalyticsLayoutContent = ({ children, periodFilter }: AnalyticsLayoutContentProps) => {
  const t = useTranslations("dashboard.analytics");
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h1>
          <p className="text-muted-foreground text-sm sm:text-base">{t("description")}</p>
        </div>
        {periodFilter}
      </div>

      {children}
    </div>
  );
};
