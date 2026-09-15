"use client";
import { DashboardSceneFrame } from "./dashboard-scene-frame";
import type { ReservationStatus } from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import { ActivityTimelineV2 } from "@/app/(dashboard)/dashboard/reservations/[id]/activity-timeline-v2";
import { ReservationIdentity } from "@/app/(dashboard)/dashboard/reservations/[id]/reservation-identity";
import { ReservationItemsCard } from "@/app/(dashboard)/dashboard/reservations/[id]/reservation-items-card";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import {
  createDemoActivities,
  getDemoReservationItems,
  type DemoBooking,
} from "@/lib/landing-demos/fixtures";

const insuredProducts = new Set<string>();
export const ReservationScene = ({
  period,
  booking,
  reservationIndex,
  onNavigate,
  status = "confirmed",
}: {
  period: RentalPeriodValue;
  booking: DemoBooking;
  reservationIndex: number;
  status?: ReservationStatus;
  onNavigate: (page: "dashboard" | "reservations") => void;
}) => {
  const items = getDemoReservationItems(booking);
  const total = Number(items.subtotalAmount);
  const deposit = Number(items.depositAmount);
  const duration = Math.max(
    1,
    Math.round((period.end.getTime() - period.start.getTime()) / 3600000),
  );
  return (
    <DashboardSceneFrame page="reservations" onNavigate={onNavigate}>
      <div className="space-y-5" data-demo-scene="reservation">
        <ReservationIdentity
          reservationNumber={String(1042 + reservationIndex)}
          status={status}
          rentalAmount={total}
          rentalPaid={status === "pending" ? 0 : total}
          depositAmount={deposit}
          depositCollected={status === "pending" ? 0 : deposit}
          depositReturned={0}
        />
        <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_1fr]">
          <ReservationItemsCard
            reservation={items}
            startDate={period.start}
            endDate={period.end}
            storeTimezone="Europe/Paris"
            durationDays={Math.floor(duration / 24)}
            durationHours={duration % 24}
            currency="EUR"
            rental={total}
            insuredProductIds={insuredProducts}
          />
          <div data-demo-target="history">
            <ActivityTimelineV2
              activities={
                status === "pending"
                  ? createDemoActivities(period.start, total, deposit).slice(-1)
                  : createDemoActivities(period.start, total, deposit)
              }
              reservationCreatedAt={period.start}
              reservationSource="online"
              currency="EUR"
              initialVisibleCount={2}
            />
          </div>
        </div>
      </div>
    </DashboardSceneFrame>
  );
};
