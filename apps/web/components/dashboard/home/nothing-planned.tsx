"use client";

import type { ReactNode } from "react";

import { ArrowRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { HomeGlassIcon, WhatsNewGlassIcon } from "@louez/ui/icons/glass";

import { useStore } from "@/contexts/store-context";
import { resolveStoreTimezone } from "@/lib/dashboard/util.store-day";

import { HomeEmptyState } from "./home-empty-state";
import type { HomeNextActivity } from "./home-types";

interface NothingPlannedProps {
  /** The first day after this one with something on it, if any is known. */
  nextActivity: HomeNextActivity | null;
  /** Said when no next day is known. */
  noneText: string;
  /** What to do when nothing comes next. */
  action?: ReactNode;
  /** Opens the next day in the card itself. */
  onGoToDay: (date: Date) => void;
}

/**
 * A day with no hand-over and no return — today or any other — and, so the
 * owner knows where to look, the next day that has some: a click opens it
 * right here, in the card.
 */
export const NothingPlanned = ({
  nextActivity,
  noneText,
  action,
  onGoToDay,
}: NothingPlannedProps) => {
  const t = useTranslations("dashboard.home");
  const format = useFormatter();
  const timeZone = resolveStoreTimezone(useStore().timezone);

  return (
    <HomeEmptyState
      size="compact"
      illustration={{ main: HomeGlassIcon, companions: [WhatsNewGlassIcon] }}
      story="quietDay"
      title={t("today.otherDay.emptyTitle")}
      description={
        nextActivity ? (
          <button
            type="button"
            onClick={() => onGoToDay(nextActivity.date)}
            className="text-primary focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {t("today.quiet.nextLine", {
              date: format.dateTime(nextActivity.date, {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone,
              }),
            })}
            <ArrowRight className="size-3.5" />
          </button>
        ) : (
          noneText
        )
      }
      action={nextActivity ? undefined : action}
    />
  );
};
