"use client";

import Link from "next/link";

import { useMutation } from "@tanstack/react-query";
import { ArrowRight, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge, Button, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import { apiErrorKey } from "@/lib/orpc/errors";
import { accountMutations } from "@/lib/queries/account.queries";

export interface LaunchSeatsOfferProps {
  /** Seats still open in the reeent launch cohort. */
  remaining: number;
  /**
   * The home's invitation to publish on reeent: the line leads to the sales
   * channels page and can be closed. The sales channels page itself shows it
   * plain, as the place where the offer can always be found.
   */
  asHomeInvitation?: boolean;
  className?: string;
}

/** "Offre de lancement": the seats a store can still claim by publishing on reeent. */
export const LaunchSeatsOffer = ({
  remaining,
  asHomeInvitation = false,
  className,
}: LaunchSeatsOfferProps) => {
  const t = useTranslations("dashboard.settings.salesChannels.cohort");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  // The line stays until the close is saved: a failed save keeps it and says so.
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

  if (remaining <= 0 || dismissal.isSuccess) return null;

  const line = (
    <>
      <Badge variant="success" className="me-2 align-middle">
        {t("incentiveBadge")}
      </Badge>
      {t("incentiveLine", { remaining: format.number(remaining) })}
    </>
  );

  if (!asHomeInvitation) {
    return <p className={cn("text-muted-foreground text-sm", className)}>{line}</p>;
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Link
        href="/dashboard/settings/marketplace"
        className="group text-muted-foreground hover:text-foreground text-sm"
      >
        {line}
        <ArrowRight className="ms-1 inline size-3.5 align-[-2px] transition-transform group-hover:translate-x-0.5" />
      </Link>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => dismissal.mutate({ noticeId: "reeent-cohort-seats" })}
        disabled={dismissal.isPending}
        aria-label={t("dismiss")}
        title={t("dismiss")}
        className="text-muted-foreground -my-1 ms-auto shrink-0"
      >
        <X />
      </Button>
    </div>
  );
};
