"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { ProductSolidIcon } from "@louez/ui/icons";
import { ProductGlassIcon, ReservationsGlassIcon, WhatsNewGlassIcon } from "@louez/ui/icons/glass";

import { GlassIllustration } from "@/components/dashboard/shared/glass-illustration";

import type { StoreMetrics, StoreState } from "./home-types";
import { OPEN_SETUP_CHECKLIST_EVENT } from "@/components/dashboard/setup/sidebar-setup-checklist";

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

  // A store that is still being set up gets a welcome panel instead of a plain
  // title: the first screen after onboarding must say "you are home, here is
  // what comes next", not show a row of zeros.
  if (storeState === "virgin" || storeState === "building") {
    return (
      <section className="animate-enter relative flex flex-col gap-6 overflow-hidden rounded-[20px] from-accent via-background to-ecume-soft bg-linear-to-br p-6 shadow-[inset_0_0_0_1px_var(--color-border)] sm:flex-row sm:items-center sm:p-8">
        <div className="relative flex min-w-0 flex-1 flex-col gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">
            {greeting}
          </h1>
          <p className="text-muted-foreground max-w-xl text-sm sm:text-base">{getSubtitle()}</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            {primaryCTA}
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => window.dispatchEvent(new Event(OPEN_SETUP_CHECKLIST_EVENT))}
            >
              {t("header.cta.openSetup")}
            </Button>
          </div>
        </div>
        <GlassIllustration
          main={ReservationsGlassIcon}
          companions={[ProductGlassIcon, WhatsNewGlassIcon]}
          className="mx-auto max-sm:hidden sm:mx-0"
        />
      </section>
    );
  }

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
