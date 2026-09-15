"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { ProductSolidIcon } from "@louez/ui/icons";

import type { StoreMetrics, StoreState } from "./home-types";

interface AdaptiveHeaderProps {
  firstName: string;
  onNavigate?: () => void;
  actionHref?: string;
  timeOfDay: "morning" | "afternoon" | "evening";
  storeState: StoreState;
  metrics: StoreMetrics;
}

export const AdaptiveHeader = ({
  firstName,
  onNavigate,
  actionHref,
  timeOfDay,
  storeState,
  metrics,
}: AdaptiveHeaderProps) => {
  const t = useTranslations("dashboard.home");

  const greeting = firstName
    ? t(`header.greeting.${timeOfDay}`, { name: firstName })
    : t(`header.greeting.${timeOfDay}Anonymous`);

  const getSubtitle = () => {
    if (storeState === "virgin") {
      return t("header.subtitle.virgin");
    }

    if (storeState === "building") {
      return t("header.subtitle.building", { count: metrics.activeProductCount });
    }

    if (metrics.pendingReservations > 0) {
      return t("header.subtitle.pending", { count: metrics.pendingReservations });
    }

    const todayOperations = metrics.todaysDepartures + metrics.todaysReturns;
    if (todayOperations > 0) {
      return t("header.subtitle.operations", { count: todayOperations });
    }

    return t("header.subtitle.calm");
  };

  const getPrimaryCTA = () => {
    if (storeState === "virgin") {
      return (
        <Button
          className="w-full sm:w-auto"
          render={
            <Link
              href={actionHref ?? "/dashboard/products/new"}
              onClick={
                onNavigate
                  ? (event) => {
                      event.preventDefault();
                      onNavigate();
                    }
                  : undefined
              }
            />
          }
        >
          <ProductSolidIcon />
          {t("header.cta.addFirstProduct")}
        </Button>
      );
    }

    if (metrics.pendingReservations > 0) {
      return (
        <Button
          className="w-full sm:w-auto"
          render={
            <Link
              href={actionHref ?? "/dashboard/reservations?status=pending"}
              onClick={
                onNavigate
                  ? (event) => {
                      event.preventDefault();
                      onNavigate();
                    }
                  : undefined
              }
            />
          }
        >
          {t("header.cta.handleRequests", { count: metrics.pendingReservations })}
          <ArrowRight />
        </Button>
      );
    }

    return null;
  };

  const primaryCTA = getPrimaryCTA();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{greeting}</h1>
        <p className="text-muted-foreground text-sm sm:text-base">{getSubtitle()}</p>
      </div>
      {primaryCTA && <div className="shrink-0">{primaryCTA}</div>}
    </div>
  );
};
