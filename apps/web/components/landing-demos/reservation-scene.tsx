"use client";
import { DashboardSceneFrame } from "./dashboard-scene-frame";
import { ReservationDetailClient } from "@/app/(dashboard)/dashboard/reservations/[id]/reservation-detail-client";
import type { ReservationStatus } from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { DemoBooking } from "@/lib/landing-demos/fixtures";
import { createDemoReservationDetail } from "@/lib/landing-demos/reservation-detail";

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
  const { reservation, invoices } = createDemoReservationDetail(
    booking,
    period,
    reservationIndex,
    status,
  );
  return (
    <DashboardSceneFrame page="reservations" onNavigate={onNavigate}>
      <div data-demo-scene="reservation">
        <ReservationDetailClient
          reservationId={reservation.id}
          initialReservation={reservation}
          storeSlug="maison-du-velo"
          currency="EUR"
          storeTimezone="Europe/Paris"
          smsConfigured={false}
          stripeConfigured={true}
          inspectionSettings={{ enabled: false, mode: "optional" }}
          showStoreLocations={true}
          departureInspection={null}
          returnInspection={null}
          invoices={invoices}
          canGenerateInvoice={true}
          readOnly
          onBack={() => onNavigate("reservations")}
        />
      </div>
    </DashboardSceneFrame>
  );
};
