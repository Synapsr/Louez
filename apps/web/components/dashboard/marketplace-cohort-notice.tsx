"use client";

import { useFormatter, useTranslations } from "next-intl";

import { RewardIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { useInstanceConfig } from "@/components/instance-provider";

import { LaunchSeatsOffer } from "./launch-seats-offer";

export interface MarketplaceCohortNoticeProps {
  /** ISO date once the store joined the launch cohort, null otherwise. */
  lifetimeFeeWaiverAt: string | null;
  cohortRank: number | null;
  /** Seats still available in the launch cohort. */
  remaining: number;
  className?: string;
}

/**
 * "Offre reeent à vie" on the sales channels page, where it can always be found.
 *
 * Two states, never both: a store already in the launch cohort keeps a quiet,
 * neutral badge for good; a store outside it sees the remaining seats — and nothing at
 * all once the cohort is full, because there is no longer anything to promise.
 * The home only ever invites to claim a seat (`LaunchSeatsOffer`), never shows the badge.
 */
export const MarketplaceCohortNotice = ({
  lifetimeFeeWaiverAt,
  cohortRank,
  remaining,
  className,
}: MarketplaceCohortNoticeProps) => {
  const t = useTranslations("dashboard.settings.salesChannels.cohort");
  const format = useFormatter();
  // The waiver is a billing promise: nothing to show when the instance does not bill.
  const { billingEnabled } = useInstanceConfig();

  if (!billingEnabled) return null;

  if (!lifetimeFeeWaiverAt) return <LaunchSeatsOffer remaining={remaining} className={className} />;

  return (
    <div
      className={cn(
        "bg-muted/40 ring-border flex items-start gap-3 rounded-xl p-4 ring-1 ring-inset",
        className,
      )}
    >
      <DashboardIconTile icon={RewardIcon} className="bg-background/70" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{t("memberTitle")}</p>
        {cohortRank !== null && (
          <p className="text-muted-foreground text-sm">
            {t("memberRank", { rank: format.number(cohortRank) })}
          </p>
        )}
      </div>
    </div>
  );
};
