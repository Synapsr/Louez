"use client";
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
  compact,
  period,
  booking,
  reservationIndex,
}: {
  compact: boolean;
  period: RentalPeriodValue;
  booking: DemoBooking;
  reservationIndex: number;
}) => {
  const items = getDemoReservationItems(booking);
  const total = Number(items.subtotalAmount);
  const deposit = Number(items.depositAmount);
  const duration = Math.max(
    1,
    Math.round((period.end.getTime() - period.start.getTime()) / 3600000),
  );
  return (
    <div className="space-y-5" data-demo-scene="reservation">
      <ReservationIdentity
        reservationNumber={String(1042 + reservationIndex)}
        status="confirmed"
        rentalAmount={total}
        rentalPaid={total}
        depositAmount={deposit}
        depositCollected={deposit}
        depositReturned={0}
      />
      <div className={compact ? "space-y-4" : "grid items-start gap-4 lg:grid-cols-[1.15fr_1fr]"}>
        {!compact && (
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
        )}
        <div data-demo-target="history">
          <ActivityTimelineV2
            activities={createDemoActivities(period.start, total, deposit)}
            reservationCreatedAt={period.start}
            reservationSource="online"
            currency="EUR"
            initialVisibleCount={compact ? 1 : 2}
          />
        </div>
      </div>
    </div>
  );
};
