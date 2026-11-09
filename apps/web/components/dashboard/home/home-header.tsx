"use client";

import { useTranslations } from "next-intl";

import type { StoreMetrics, StoreState } from "./home-types";

interface HomeHeaderProps {
  firstName: string;
  timeOfDay: "morning" | "afternoon" | "evening";
  storeState: StoreState;
  metrics: StoreMetrics;
}

/**
 * The home's greeting and the sentence of the moment, nothing else: every
 * action lives in the card it belongs to, and "New reservation" stays in the
 * layout header.
 */
export const HomeHeader = ({ firstName, timeOfDay, storeState, metrics }: HomeHeaderProps) => {
  const t = useTranslations("dashboard.home");

  const greeting = firstName
    ? t(`header.greeting.${timeOfDay}`, { name: firstName })
    : t(`header.greeting.${timeOfDay}Anonymous`);

  const subtitle = (() => {
    if (storeState === "virgin") return t("header.subtitle.virgin");
    if (storeState === "building") {
      return t("header.subtitle.building", { count: metrics.activeProductCount });
    }
    if (metrics.pendingReservations > 0) {
      return t("header.subtitle.pending", { count: metrics.pendingReservations });
    }
    const todayOperations = metrics.todaysDepartures + metrics.todaysReturns;
    if (todayOperations > 0) return t("header.subtitle.operations", { count: todayOperations });
    return t("header.subtitle.calm");
  })();

  return (
    <div className="min-w-0 space-y-1">
      <h1 className="text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">{greeting}</h1>
      <p className="text-muted-foreground text-sm sm:text-base">{subtitle}</p>
    </div>
  );
};
