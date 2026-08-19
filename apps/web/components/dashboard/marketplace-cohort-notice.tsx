"use client";

import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { RewardIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

export interface MarketplaceCohortNoticeProps {
  /** ISO date once the store joined the launch cohort, null otherwise. */
  lifetimeFeeWaiverAt: string | null;
  cohortRank: number | null;
  /** Seats still available in the launch cohort. */
  remaining: number;
  className?: string;
}

/**
 * "Offre reeent à vie" surface, shared by the marketplace settings page and the
 * dashboard home so the promise reads identically wherever it appears.
 *
 * Two states, never both: a store already in the launch cohort keeps a quiet
 * badge for good; a store outside it sees the remaining seats — and nothing at
 * all once the cohort is full, because there is no longer anything to promise.
 */
export const MarketplaceCohortNotice = ({
  lifetimeFeeWaiverAt,
  cohortRank,
  remaining,
  className,
}: MarketplaceCohortNoticeProps) => {
  const t = useTranslations("dashboard.settings.salesChannels.cohort");
  const format = useFormatter();

  if (lifetimeFeeWaiverAt) {
    return (
      <div
        className={cn(
          "bg-badge-success-background/60 ring-badge-success-foreground/15 flex items-start gap-3 rounded-xl p-4 ring-1 ring-inset",
          className,
        )}
      >
        <DashboardIconTile icon={RewardIcon} accent="success" className="bg-background/70" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{t("memberTitle")}</p>
          {cohortRank !== null && (
            <p className="text-muted-foreground text-sm">
              {t("memberRank", { rank: format.number(cohortRank) })}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (remaining <= 0) {
    return null;
  }

  return (
    <p className={cn("text-muted-foreground flex flex-wrap items-center gap-2 text-sm", className)}>
      <Badge variant="success">{t("incentiveBadge")}</Badge>
      {t("incentiveLine", { remaining: format.number(remaining) })}
    </p>
  );
};
