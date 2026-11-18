"use client";

import { useEffect, useRef } from "react";

import Link from "next/link";

import { useMutation } from "@tanstack/react-query";
import { Megaphone, X } from "lucide-react";
import { useTranslations } from "next-intl";

import type { VisibilityView } from "@louez/api/contracts/visibility";
import { Button, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import { apiErrorKey } from "@/lib/orpc/errors";
import { accountMutations } from "@/lib/queries/account.queries";

import { useVisibilityAnalytics } from "./use-visibility-analytics";
import {
  VISIBILITY_GUIDE_NOTICE_ID,
  nextVisibilityStep,
  visibilityCounts,
} from "./util.visibility-steps";

interface VisibilityHomeCardProps {
  storeId: string;
  /** Read by the page on the server. */
  view: VisibilityView;
  className?: string;
}

/**
 * The home's way into "Se faire connaître": the next step only. Gone once
 * every step is done or skipped, or once the user closes it for good.
 */
export const VisibilityHomeCard = ({ storeId, view, className }: VisibilityHomeCardProps) => {
  const t = useTranslations("dashboard.visibility");
  const tErrors = useTranslations("errors");
  const analytics = useVisibilityAnalytics(storeId);
  const next = nextVisibilityStep(view.steps);
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

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current || !next) return;
    tracked.current = true;
    analytics.viewed("home_card", visibilityCounts(view.steps));
  }, [analytics, next, view.steps]);

  if (!next || dismissal.isSuccess) return null;

  return (
    <div
      className={cn(
        "bg-card ring-border relative flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-inset sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3 pr-8 sm:pr-0">
        <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Megaphone className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{t("homeCard.title")}</p>
          <p className="text-muted-foreground text-sm">
            {t("homeCard.next", { step: t(`steps.${next.key}.title`) })}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:self-end">
        <Button render={<Link href="/dashboard/visibility" />}>{t("homeCard.action")}</Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("homeCard.dismiss")}
          disabled={dismissal.isPending}
          onClick={() => dismissal.mutate({ noticeId: VISIBILITY_GUIDE_NOTICE_ID })}
          className="max-sm:absolute max-sm:top-3 max-sm:right-3"
        >
          <X />
        </Button>
      </div>
    </div>
  );
};
