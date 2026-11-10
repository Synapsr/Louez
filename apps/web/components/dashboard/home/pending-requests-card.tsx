"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge, Button } from "@louez/ui";
import { ClockSolidIcon } from "@louez/ui/icons";
import { ReservationsGlassIcon } from "@louez/ui/icons/glass";
import { cn } from "@louez/utils";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { useStore } from "@/contexts/store-context";
import type { FirstDayPath as FirstDayPathData } from "@/lib/dashboard/util.first-day-path";
import type { HomeTipKey } from "@/lib/dashboard/util.home-tip";
import type { PaymentsSetupState } from "@/lib/dashboard/util.payments-setup";
import { resolveStoreTimezone } from "@/lib/dashboard/util.store-day";

import { ActivityListItem } from "./activity-list-item";
import { FirstDayPath } from "./first-day-path";
import { HomeEmptyState } from "./home-empty-state";
import { HomeListMore } from "./home-list-more";
import { HomeScrollZone } from "./home-scroll-zone";
import { HomeTip } from "./home-tip";
import { PaymentsSetupStatus } from "./payments-setup-status";
import type { PendingHomeReservation } from "./home-types";
import { PendingUrgencyBadge } from "./pending-urgency-badge";

const PENDING_HREF = "/dashboard/reservations?status=pending&source=home_pending";
/** Rows shown while the cards are stacked; side by side, the card scrolls. */
const STACKED_ROWS = 5;

interface PendingRequestsCardProps {
  /** Soonest start first, as many as the side-by-side card scrolls through. */
  pending: PendingHomeReservation[];
  pendingCount: number;
  /** A new store's way to its first request; null once it has activity. */
  firstDay: FirstDayPathData | null;
  /** One "next step" for a starting store that is up to date. */
  tip: HomeTipKey | null;
  storeSlug: string;
  storeName: string;
  /**
   * Another action outranks this card's (the payment banner asks to activate
   * payments first): its button steps down to secondary.
   */
  hasPriorityAction: boolean;
  /** Online payment chosen, Stripe not charging yet. */
  paymentsSetup: PaymentsSetupState | null;
  /** A reeent store's banner already speaks for Stripe. */
  isFromReeent: boolean;
  /** Server-side "now", so the relative times match the rendered markup. */
  now: Date;
  className?: string;
}

/**
 * The requests waiting for an answer. Before any request can exist, the card
 * walks a new store through what unlocks them: a product, Stripe when it
 * chose online payment, then sharing the store. After that, an unfinished
 * Stripe reads as one line on top, and a tip may close the card.
 */
export const PendingRequestsCard = ({
  pending,
  pendingCount,
  firstDay,
  tip,
  storeSlug,
  storeName,
  hasPriorityAction,
  paymentsSetup,
  isFromReeent,
  now,
  className,
}: PendingRequestsCardProps) => {
  const t = useTranslations("dashboard.home");
  const format = useFormatter();
  const timeZone = resolveStoreTimezone(useStore().timezone);

  const body = (() => {
    if (firstDay && pending.length === 0) {
      return (
        <HomeScrollZone label={t("pending.title")}>
          <FirstDayPath
            path={firstDay}
            storeSlug={storeSlug}
            storeName={storeName}
            hasPriorityAction={hasPriorityAction}
            paymentsSetup={paymentsSetup}
            isFromReeent={isFromReeent}
          />
        </HomeScrollZone>
      );
    }
    if (pending.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center">
          <HomeEmptyState
            size="compact"
            illustration={{ main: ReservationsGlassIcon }}
            title={t("requestsEmpty.upToDateTitle")}
            description={t("pending.empty")}
            story="upToDate"
          />
        </div>
      );
    }
    return (
      <HomeScrollZone label={t("pending.title")}>
        <div className="-mx-2 space-y-0.5 sm:-mx-3 @max-[55rem]/home:[&>*:nth-child(n+6)]:hidden">
          {pending.map((reservation) => (
            <ActivityListItem
              key={reservation.id}
              reservation={reservation}
              accent="pending"
              showAmount
              badge={<PendingUrgencyBadge urgency={reservation.urgency} />}
              subtitle={
                <>
                  <ClockSolidIcon className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {format.dateTime(reservation.startDate, {
                      day: "2-digit",
                      month: "2-digit",
                      timeZone,
                    })}{" "}
                    —{" "}
                    {format.dateTime(reservation.endDate, {
                      day: "2-digit",
                      month: "2-digit",
                      timeZone,
                    })}
                    <span className="text-muted-foreground/70">
                      {" "}
                      ·{" "}
                      {t("pending.requested", {
                        relative: format.relativeTime(reservation.createdAt, now),
                      })}
                    </span>
                  </span>
                </>
              }
              source="home_pending"
            />
          ))}
        </div>
        <HomeListMore
          href={PENDING_HREF}
          count={pendingCount - STACKED_ROWS}
          className="@min-[55rem]/home:hidden"
        />
        <HomeListMore
          href={PENDING_HREF}
          count={pendingCount - pending.length}
          className="@max-[55rem]/home:hidden"
        />
      </HomeScrollZone>
    );
  })();

  return (
    <DashboardSectionCard
      title={t("pending.title")}
      className={cn("@min-[55rem]/home:min-h-0", className)}
      contentClassName="flex min-h-0 flex-col gap-3"
      action={
        pendingCount > 0 ? (
          <>
            <Badge className="bg-primary text-primary-foreground rounded-full tabular-nums">
              {pendingCount}
            </Badge>
            <Button variant="ghost" size="sm" render={<Link href={PENDING_HREF} />}>
              <span className="max-sm:sr-only">{t("viewAll")}</span>
              <ArrowRight />
            </Button>
          </>
        ) : undefined
      }
    >
      {paymentsSetup && !firstDay && !isFromReeent && (
        <div className="shrink-0">
          <PaymentsSetupStatus state={paymentsSetup} />
        </div>
      )}
      {body}
      {tip && (
        <div className="shrink-0">
          <HomeTip tip={tip} />
        </div>
      )}
    </DashboardSectionCard>
  );
};
