"use client";

import type { ComponentType } from "react";

import Link from "next/link";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { CheckCircleIcon } from "@louez/ui/icons";

import { ActivityListItem } from "./activity-list-item";
import type { DashboardAccent } from "@/components/dashboard/shared/dashboard-accent";
import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import type { ReservationAnalyticsSource } from "@/lib/product-analytics/reservation-analytics";
import type { HomeReservation } from "./home-types";

export interface ActivityCardViewProps {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  accent: DashboardAccent;
  reservations: HomeReservation[];
  emptyMessage: string;
  viewAllHref: string;
  action?: React.ReactNode;
  onViewAll?: () => void;
  onSelectReservation?: (reservation: HomeReservation) => void;
  showPeriod?: boolean;
  showAmount?: boolean;
  className?: string;
  reservationSource: ReservationAnalyticsSource;
}

/** A list of reservations (departures, returns, pending requests). */
export const ActivityCardView = ({
  title,
  description,
  icon,
  accent,
  reservations,
  emptyMessage,
  viewAllHref,
  action,
  onViewAll,
  onSelectReservation,
  showPeriod = false,
  showAmount = false,
  className,
  reservationSource,
}: ActivityCardViewProps) => {
  const t = useTranslations("dashboard.home");
  const viewAllAction = (
    <Button
      variant="ghost"
      size="sm"
      onClick={onViewAll}
      render={onViewAll ? undefined : <Link href={viewAllHref} />}
    >
      <span className="max-sm:sr-only">{t("viewAll")}</span>
      <ArrowRight />
    </Button>
  );

  return (
    <DashboardSectionCard
      title={title}
      description={description}
      icon={icon}
      accent={accent}
      className={className}
      action={action ?? viewAllAction}
    >
      {reservations.length === 0 ? (
        <DashboardEmptyState icon={CheckCircleIcon} description={emptyMessage} />
      ) : (
        <div className="-mx-2 space-y-0.5 sm:-mx-3">
          {reservations.map((reservation) => (
            <ActivityListItem
              key={reservation.id}
              reservation={reservation}
              accent={accent}
              showPeriod={showPeriod}
              showAmount={showAmount}
              source={reservationSource}
              onSelect={onSelectReservation ? () => onSelectReservation(reservation) : undefined}
            />
          ))}
        </div>
      )}
    </DashboardSectionCard>
  );
};
