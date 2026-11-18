"use client";

import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";

import type { VisibilityView, VisitSource } from "@louez/api/contracts/visibility";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";

/** The visits the guide's marked links brought, by channel. */
export const VisibilityVisitsCard = ({ visits }: { visits: VisibilityView["visits"] }) => {
  const t = useTranslations("dashboard.visibility.visits");

  return (
    <DashboardSectionCard
      title={t("title")}
      description={t("period")}
      icon={Globe}
      accent="progress"
      action={
        visits.total > 0 ? (
          <span className="text-2xl font-semibold tabular-nums">{visits.total}</span>
        ) : undefined
      }
    >
      {visits.total === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visits.bySource.map((row) => (
            <li key={row.source} className="flex items-center justify-between text-sm">
              <span>{t(`sources.${row.source satisfies VisitSource}`)}</span>
              <span className="font-medium tabular-nums">{row.visits}</span>
            </li>
          ))}
        </ul>
      )}
    </DashboardSectionCard>
  );
};
