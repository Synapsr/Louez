"use client";

import { ReservationDetailClient } from "@/app/(dashboard)/dashboard/reservations/[id]/reservation-detail-client";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { createDemoContractDetail } from "@/lib/landing-demos/contracts";
import snapshot from "@/public/demo-documents/reservation.json";

export const ContractReservation = ({ onBack }: { onBack: () => void }) => {
  const { reservation, invoices } = createDemoContractDetail(useDemoLocale(), snapshot);
  return (
    <div data-demo-target="contract-reservation">
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
        onBack={onBack}
      />
    </div>
  );
};
