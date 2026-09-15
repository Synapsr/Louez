"use client";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActivityCardView } from "@/components/dashboard/home/activity-card-view";
import { DashboardStatCard } from "@/components/dashboard/shared/dashboard-stat-card";
import {
  createDemoReservations,
  DEMO_PRODUCTS,
  type DemoBooking,
} from "@/lib/landing-demos/fixtures";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";

export const PlanningScene = ({
  compact,
  period,
  onOpenReservation,
  booking,
}: {
  compact: boolean;
  period: RentalPeriodValue;
  booking: DemoBooking;
  onOpenReservation: (index: number) => void;
}) => {
  const t = useTranslations("dashboard.home");
  const reservations = createDemoReservations(period.start, period.end);
  const product = DEMO_PRODUCTS[booking.productIndex] ?? DEMO_PRODUCTS[0];
  reservations[0] = {
    ...reservations[0],
    totalAmount: String(booking.unitPrice * booking.quantity),
    items: Array.from({ length: booking.quantity }, (_, index) => ({
      id: `demo-item-${index}`,
      product: { name: product.name },
    })),
  };
  const select = (reservation: (typeof reservations)[number]) =>
    onOpenReservation(reservations.findIndex((item) => item.id === reservation.id));
  return (
    <div className="space-y-5" data-demo-scene="planning">
      {!compact && (
        <div className="grid grid-cols-2 gap-3">
          <DashboardStatCard
            title={t("activity.departures")}
            value="3"
            icon={ArrowUpRight}
            accent="success"
          />
          <DashboardStatCard
            title={t("activity.returns")}
            value="2"
            icon={ArrowDownRight}
            accent="progress"
          />
        </div>
      )}
      <div className={compact ? "space-y-4" : "grid gap-4 lg:grid-cols-2"}>
        <div data-demo-target="departures">
          <ActivityCardView
            title={t("activity.departures")}
            description={t("activity.departuresDescription")}
            icon={ArrowUpRight}
            accent="success"
            reservations={compact ? reservations.slice(0, 2) : reservations}
            emptyMessage={t("activity.noDepartures")}
            viewAllHref="/demos/landing/planning"
            reservationSource="home_departure"
            onSelectReservation={select}
            onViewAll={() => onOpenReservation(0)}
          />
        </div>
        {!compact && (
          <ActivityCardView
            title={t("activity.returns")}
            description={t("activity.returnsDescription")}
            icon={ArrowDownRight}
            accent="progress"
            reservations={reservations.slice(1)}
            emptyMessage={t("activity.noReturns")}
            viewAllHref="/demos/landing/planning"
            reservationSource="home_return"
            onSelectReservation={select}
            onViewAll={() => onOpenReservation(0)}
          />
        )}
      </div>
    </div>
  );
};
