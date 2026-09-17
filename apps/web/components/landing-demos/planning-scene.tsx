"use client";
import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Calendar, Clock, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { ActivityCardView } from "@/components/dashboard/home/activity-card-view";
import { AdaptiveHeader } from "@/components/dashboard/home/adaptive-header";
import { DashboardStatCard } from "@/components/dashboard/shared/dashboard-stat-card";
import { ReservationsTableView } from "@/app/(dashboard)/dashboard/reservations/reservations-table-view";
import { ReservationsViewSwitcher } from "@/app/(dashboard)/dashboard/reservations/reservations-view-switcher";
import { ReservationsPageHeading } from "@/app/(dashboard)/dashboard/reservations/reservations-page-heading";
import { ReservationsCalendarView } from "@/app/(dashboard)/dashboard/reservations/calendar/calendar-view";
import type {
  SortField,
  SortDirection,
  ReservationStatus,
} from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { DemoBooking } from "@/lib/landing-demos/fixtures";
import { createDemoReservationPages } from "@/lib/landing-demos/reservations";
import { DashboardSceneFrame } from "./dashboard-scene-frame";
import { useDemoLocale } from "./use-demo-locale";

type DemoView = "dashboard" | "list" | "calendar";
const availableViews = ["list", "calendar"] as const;
export const PlanningScene = ({
  period,
  onOpenReservation,
  booking,
  initialView = "dashboard",
}: {
  period: RentalPeriodValue;
  booking: DemoBooking;
  initialView?: DemoView;
  onOpenReservation: (
    index: number,
    booking: DemoBooking,
    period: RentalPeriodValue,
    status: ReservationStatus,
  ) => void;
}) => {
  const t = useTranslations("dashboard.home");
  const tReservations = useTranslations("dashboard.reservations");
  const [view, setView] = useState<DemoView>(initialView);
  const [sort, setSort] = useState<SortField>("number");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const locale = useDemoLocale();
  const data = useMemo(
    () => createDemoReservationPages(period, booking, locale),
    [period, booking, locale],
  );
  const rows = data.rows;
  const sorted = [...rows].sort((a, b) => {
    const comparison =
      sort === "startDate"
        ? a.startDate.getTime() - b.startDate.getTime()
        : sort === "amount"
          ? Number(a.subtotalAmount) - Number(b.subtotalAmount)
          : sort === "number"
            ? Number(a.number) - Number(b.number)
            : (a.status ?? "").localeCompare(b.status ?? "");
    return comparison * (direction === "asc" ? 1 : -1);
  });
  const select = (id: string) => {
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return;
    const row = rows[index];
    onOpenReservation(
      index,
      data.bookings[index],
      { start: row.startDate, end: row.endDate },
      row.status ?? "confirmed",
    );
  };
  const activities = rows.slice(0, 3).map((row) => ({
    ...row,
    items: row.items.flatMap((item) =>
      Array.from({ length: item.quantity }, (_, index) => ({
        id: `${item.id}-${index}`,
        product: item.product,
      })),
    ),
  }));
  const pendingCount = rows.filter((row) => row.status === "pending").length;
  return (
    <DashboardSceneFrame
      page={view === "dashboard" ? "dashboard" : "reservations"}
      onNavigate={(page) => setView(page === "dashboard" ? "dashboard" : "list")}
    >
      <div
        data-demo-scene="planning"
        data-demo-page={view}
        className={
          view === "calendar" ? "flex h-[calc(100svh-7.5rem)] min-h-96 flex-col gap-4" : "space-y-6"
        }
      >
        {view === "dashboard" ? (
          <>
            <AdaptiveHeader
              firstName="Alex"
              timeOfDay="morning"
              storeState="active"
              actionHref="/demos/landing/planning"
              onNavigate={() => setView("list")}
              metrics={{
                productCount: 12,
                activeProductCount: 12,
                draftProductCount: 0,
                customerCount: 24,
                newCustomersThisMonth: 6,
                totalReservations: 24,
                completedReservations: 0,
                pendingReservations: pendingCount,
                confirmedReservations: 16,
                ongoingReservations: 4,
                todaysDepartures: 3,
                todaysReturns: 2,
                monthlyRevenue: 1280,
                lastMonthRevenue: 1080,
                allTimeRevenue: 4680,
              }}
            />
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <DashboardStatCard
                title={t("stats.todaysDepartures")}
                value="3"
                icon={ArrowUpRight}
                accent="success"
                subtitle={t("stats.toDeliver")}
              />
              <DashboardStatCard
                title={t("stats.todaysReturns")}
                value="2"
                icon={ArrowDownRight}
                accent="progress"
                subtitle={t("stats.toRecover")}
              />
              <DashboardStatCard
                title={t("stats.pendingRequests")}
                value={pendingCount}
                icon={Clock}
                accent="pending"
              />
              <DashboardStatCard
                title={t("stats.totalReservations")}
                value={rows.length}
                icon={Calendar}
                accent="neutral"
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div data-demo-target="departures">
                <ActivityCardView
                  title={t("activity.departures")}
                  description={t("activity.departuresDescription")}
                  icon={ArrowUpRight}
                  accent="success"
                  reservations={activities}
                  emptyMessage={t("activity.noDepartures")}
                  viewAllHref="/demos/landing/planning"
                  reservationSource="home_departure"
                  onSelectReservation={(reservation) => select(reservation.id)}
                  onViewAll={() => setView("list")}
                />
              </div>
              <ActivityCardView
                title={t("activity.returns")}
                description={t("activity.returnsDescription")}
                icon={ArrowDownRight}
                accent="progress"
                reservations={activities.slice(1)}
                emptyMessage={t("activity.noReturns")}
                viewAllHref="/demos/landing/planning"
                reservationSource="home_return"
                onSelectReservation={(reservation) => select(reservation.id)}
                onViewAll={() => setView("calendar")}
              />
            </div>
          </>
        ) : (
          <>
            <ReservationsPageHeading
              actions={
                <>
                  <ReservationsViewSwitcher
                    view={view}
                    views={availableViews}
                    onViewChange={(next) => {
                      if (next === "list" || next === "calendar") setView(next);
                    }}
                  />
                  <Button
                    disabled
                    aria-label={tReservations("createReservation")}
                    className="max-xl:size-9 max-xl:px-0"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="max-xl:hidden">{tReservations("createReservation")}</span>
                  </Button>
                </>
              }
            />
            {view === "list" ? (
              <ReservationsTableView
                reservations={sorted}
                currency="EUR"
                timezone="Europe/Paris"
                currentSort={sort}
                currentSortDirection={direction}
                onSortChange={(next) => {
                  setDirection(next === sort && direction === "asc" ? "desc" : "asc");
                  setSort(next);
                }}
                loadingAction={null}
                readOnly
                handleStatusChange={async () => undefined}
                openRejectDialog={() => undefined}
                onOpenReservation={(reservation) => select(reservation.id)}
                getReservationHref={() => "/demos/landing/reservation"}
              />
            ) : (
              <ReservationsCalendarView
                products={data.products}
                reservations={data.calendar}
                initialDate={period.start}
                currency="EUR"
                storeId="demo-store"
                storeHasReservations
                readOnly
                persistFilters={false}
                onOpenReservation={select}
                getReservationHref={() => "/demos/landing/reservation"}
              />
            )}
          </>
        )}
      </div>
    </DashboardSceneFrame>
  );
};
