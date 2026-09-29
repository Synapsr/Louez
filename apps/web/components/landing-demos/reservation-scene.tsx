"use client";
import { DashboardSceneFrame } from "./dashboard-scene-frame";
import { ReservationDetailClient } from "@/app/(dashboard)/dashboard/reservations/[id]/reservation-detail-client";
import type { ReservationStatus } from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { DemoBooking } from "@/lib/landing-demos/fixtures";
import { createDemoReservationDetail } from "@/lib/landing-demos/reservation-detail";
import { useDemoLocale } from "./use-demo-locale";

export const ReservationScene = ({
  period,
  booking,
  reservationIndex,
  onNavigate,
  onPreviewEmail,
  status = "confirmed",
}: {
  period: RentalPeriodValue;
  booking: DemoBooking;
  reservationIndex: number;
  status?: ReservationStatus;
  /** Lets the header's email button open the caller's own preview window. */
  onPreviewEmail?: () => void;
  onNavigate: (page: "dashboard" | "reservations") => void;
}) => {
  const locale = useDemoLocale();
  const { reservation, invoices } = createDemoReservationDetail(
    booking,
    period,
    reservationIndex,
    status,
    locale,
  );
  return (
    <DashboardSceneFrame
      page="reservations"
      pages={["dashboard", "reservations"]}
      onNavigate={(page) => onNavigate(page === "dashboard" ? "dashboard" : "reservations")}
    >
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
          onPreviewEmail={onPreviewEmail}
          onBack={() => onNavigate("reservations")}
        />
      </div>
    </DashboardSceneFrame>
  );
};
