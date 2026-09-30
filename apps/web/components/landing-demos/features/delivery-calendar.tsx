"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";

import { ReservationsCalendarView } from "@/app/(dashboard)/dashboard/reservations/calendar/calendar-view";
import { ReservationsPageHeading } from "@/app/(dashboard)/dashboard/reservations/reservations-page-heading";
import { ReservationsViewSwitcher } from "@/app/(dashboard)/dashboard/reservations/reservations-view-switcher";
import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoDeliveryCalendar } from "@/lib/landing-demos/delivery";
import { getDemoToday } from "@/lib/landing-demos/reservations";

export const DeliveryCalendarScene = ({
  period,
  booking,
  onOpenReservation,
}: FeatureSceneProps) => {
  const t = useTranslations("dashboard.reservations");
  const locale = useDemoLocale();
  const data = useMemo(
    () => createDemoDeliveryCalendar(period, booking, locale),
    [period, booking, locale],
  );

  const openReservation = (id: string) => {
    const index = data.calendar.findIndex((reservation) => reservation.id === id);
    if (index < 0) return;
    const reservation = data.calendar[index];
    onOpenReservation(
      index,
      data.bookings[index],
      { start: reservation.startDate, end: reservation.endDate },
      reservation.status ?? "confirmed",
    );
  };

  return (
    <DashboardSceneFrame page="reservations" pages={["reservations"]}>
      <div
        data-demo-scene="delivery-calendar"
        className="flex h-[calc(100svh-7.5rem)] min-h-96 flex-col gap-4"
      >
        <ReservationsPageHeading
          actions={
            <>
              <ReservationsViewSwitcher view="calendar" onViewChange={() => undefined} />
              <Button
                disabled
                aria-label={t("createReservation")}
                className="max-xl:size-9 max-xl:px-0"
              >
                <Plus className="h-4 w-4" />
                <span className="max-xl:hidden">{t("createReservation")}</span>
              </Button>
            </>
          }
        />
        <ReservationsCalendarView
          products={data.products}
          reservations={data.calendar}
          initialDate={getDemoToday(period)}
          currency="EUR"
          storeId="demo-store"
          storeHasReservations
          readOnly
          persistFilters={false}
          onOpenReservation={openReservation}
          getReservationHref={() => "/demos/landing/reservation"}
        />
      </div>
    </DashboardSceneFrame>
  );
};
