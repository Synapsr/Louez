"use client";

import { useEffect } from "react";

import { useRouter } from "next/navigation";

import { useQuery } from "@tanstack/react-query";

import type { DashboardReservationEditContext } from "@louez/api/services";
import type { StoreSettings, TulipPublicMode } from "@louez/types";

import { getDateChangeRequests } from "@/lib/reservations/util.date-change-request";
import { orpc } from "@/lib/orpc/react";

import { EditReservationForm } from "./edit-reservation-form";
import type { StoreDeliveryInfo } from "./types";

interface EditReservationPageClientProps {
  reservationId: string;
  initialContext: DashboardReservationEditContext;
  currency: string;
  tulipInsuranceMode: TulipPublicMode;
  storeSettings: StoreSettings | null;
  storeDelivery: StoreDeliveryInfo | null;
}

export const EditReservationPageClient = ({
  reservationId,
  initialContext,
  currency,
  tulipInsuranceMode,
  storeSettings,
  storeDelivery,
}: EditReservationPageClientProps) => {
  const router = useRouter();
  const contextQuery = useQuery({
    ...orpc.dashboard.reservations.getEditContext.queryOptions({
      input: { reservationId },
    }),
    initialData: initialContext,
  });
  const context = contextQuery.data;

  useEffect(() => {
    if (!context.editable) {
      router.replace(`/dashboard/reservations/${reservationId}`);
    }
  }, [context.editable, reservationId, router]);

  if (!context.editable) {
    return null;
  }

  const { reservation } = context;
  // The form keeps a draft in local state, and Cache Components keeps that
  // state alive after the owner leaves the page. Remount on every server-side
  // change, so an item added last time never comes back with its temporary
  // "new-" id (saving it would replace the real item and drop its units).
  const formKey = [
    new Date(reservation.updatedAt).getTime(),
    ...reservation.items.map((item) => `${item.id}:${item.quantity}`),
  ].join("|");

  return (
    <EditReservationForm
      key={formKey}
      dateChangeRequest={
        getDateChangeRequests(context.activity).find((request) => request.status === "pending") ??
        null
      }
      reservation={reservation}
      availableProducts={context.availableProducts}
      existingReservations={context.existingReservations}
      currency={currency}
      tulipInsuranceMode={tulipInsuranceMode}
      storeSettings={storeSettings}
      storeDelivery={storeDelivery}
    />
  );
};
