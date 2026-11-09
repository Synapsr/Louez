"use client";

import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { DismissibleNoticeId } from "@louez/api/contracts/dismissed-notices";
import { Badge, Button, toastManager } from "@louez/ui";
import { RewardIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { useInstanceConfig } from "@/components/instance-provider";
import { apiErrorKey } from "@/lib/orpc/errors";
import { accountMutations } from "@/lib/queries/account.queries";

export interface MarketplaceCohortNoticeProps {
  /** ISO date once the store joined the launch cohort, null otherwise. */
  lifetimeFeeWaiverAt: string | null;
  cohortRank: number | null;
  /** Seats still available in the launch cohort. */
  remaining: number;
  /**
   * Notices this user already closed. Passing it makes the notice closable:
   * the dashboard home does, the marketplace settings page keeps it as the
   * place where the offer can always be found.
   */
  dismissedNoticeIds?: readonly DismissibleNoticeId[];
  className?: string;
}

/**
 * "Offre reeent à vie" surface, shared by the marketplace settings page and the
 * dashboard home so the promise reads identically wherever it appears.
 *
 * Two states, never both: a store already in the launch cohort keeps a quiet,
 * neutral badge for good; a store outside it sees the remaining seats — and nothing at
 * all once the cohort is full, because there is no longer anything to promise.
 * Each state is closed on its own, so closing the seats pitch does not hide the
 * badge earned later.
 */
export const MarketplaceCohortNotice = ({
  lifetimeFeeWaiverAt,
  cohortRank,
  remaining,
  dismissedNoticeIds,
  className,
}: MarketplaceCohortNoticeProps) => {
  const t = useTranslations("dashboard.settings.salesChannels.cohort");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  // The waiver is a billing promise: nothing to show when the instance does not bill.
  const { billingEnabled } = useInstanceConfig();
  const noticeId: DismissibleNoticeId = lifetimeFeeWaiverAt
    ? "reeent-cohort-member"
    : "reeent-cohort-seats";
  // The notice stays until the close is saved: a failed save keeps it and says so.
  const dismissal = useMutation({
    ...accountMutations.dismissNotice(),
    onError: (error) => {
      const key = apiErrorKey(error);
      toastManager.add({
        title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
    },
  });
  const dismissible = dismissedNoticeIds !== undefined;

  if (!billingEnabled || dismissal.isSuccess || dismissedNoticeIds?.includes(noticeId)) {
    return null;
  }

  const dismissButton = dismissible && (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => dismissal.mutate({ noticeId })}
      disabled={dismissal.isPending}
      aria-label={t("dismiss")}
      title={t("dismiss")}
      className="text-muted-foreground -my-1 ms-auto shrink-0"
    >
      <X />
    </Button>
  );

  if (lifetimeFeeWaiverAt) {
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
        {dismissButton}
      </div>
    );
  }

  if (remaining <= 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="success">{t("incentiveBadge")}</Badge>
        {t("incentiveLine", { remaining: format.number(remaining) })}
      </p>
      {dismissButton}
    </div>
  );
};
