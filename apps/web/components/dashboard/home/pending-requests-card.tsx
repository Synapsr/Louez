"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button } from "@louez/ui";
import { ProductSolidIcon } from "@louez/ui/icons";
import { ProductGlassIcon, ReservationsGlassIcon, WhatsNewGlassIcon } from "@louez/ui/icons/glass";
import { cn } from "@louez/utils";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";

import { ActivityListItem } from "./activity-list-item";
import { HomeEmptyState } from "./home-empty-state";
import type { HomeReservation, StoreState } from "./home-types";
import { ShareStoreActions } from "./share-store-actions";

interface PendingRequestsCardProps {
  storeState: StoreState;
  pending: HomeReservation[];
  pendingCount: number;
  storeSlug: string;
  storeName: string;
  /**
   * Another action outranks this card's (the reeent banner asks to activate
   * payments first): its button steps down to secondary.
   */
  hasPriorityAction: boolean;
  className?: string;
}

/**
 * The requests waiting for an answer. Before any request can exist, the card
 * leads to what unlocks them: the first product, then sharing the store.
 */
export const PendingRequestsCard = ({
  storeState,
  pending,
  pendingCount,
  storeSlug,
  storeName,
  hasPriorityAction,
  className,
}: PendingRequestsCardProps) => {
  const t = useTranslations("dashboard.home");

  const body = (() => {
    if (storeState === "virgin") {
      return (
        <HomeEmptyState
          illustration={{ main: ProductGlassIcon, companions: [ReservationsGlassIcon, WhatsNewGlassIcon] }}
          title={t("requestsEmpty.virginTitle")}
          description={t("requestsEmpty.virginText")}
          action={
            <Button
              variant={hasPriorityAction ? "outline" : "default"}
              render={<Link href="/dashboard/products/new" />}
            >
              <ProductSolidIcon />
              {t("header.cta.addFirstProduct")}
            </Button>
          }
        />
      );
    }
    if (storeState === "building" && pending.length === 0) {
      return (
        <HomeEmptyState
          illustration={{ main: ReservationsGlassIcon, companions: [ProductGlassIcon, WhatsNewGlassIcon] }}
          title={t("requestsEmpty.buildingTitle")}
          description={t("requestsEmpty.buildingText")}
          action={<ShareStoreActions storeSlug={storeSlug} storeName={storeName} />}
        />
      );
    }
    if (pending.length === 0) {
      return (
        <HomeEmptyState
          size="compact"
          illustration={{ main: ReservationsGlassIcon }}
          title={t("requestsEmpty.upToDateTitle")}
          description={t("pending.empty")}
        />
      );
    }
    return (
      <div className="-mx-2 space-y-0.5 sm:-mx-3">
        {pending.map((reservation) => (
          <ActivityListItem
            key={reservation.id}
            reservation={reservation}
            accent="pending"
            showPeriod
            showAmount
            source="home_pending"
          />
        ))}
      </div>
    );
  })();

  return (
    <DashboardSectionCard
      title={t("pending.title")}
      className={cn("min-h-full", className)}
      contentClassName="flex flex-col"
      action={
        pendingCount > 0 ? (
          <>
            <Badge className="bg-primary text-primary-foreground rounded-full tabular-nums">
              {pendingCount}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/dashboard/reservations?status=pending&source=home_pending" />}
            >
              <span className="max-sm:sr-only">{t("viewAll")}</span>
              <ArrowRight />
            </Button>
          </>
        ) : undefined
      }
    >
      {body}
    </DashboardSectionCard>
  );
};
