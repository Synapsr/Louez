import { notFound, redirect } from "next/navigation";

import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";

import { getDashboardReservationEditContext } from "@louez/api/services";
import { db, storeLocations } from "@louez/db";
import type { DeliverySettings } from "@louez/types";

import { getDashboardTulipInsuranceModeFromSettings } from "@/lib/integrations/tulip/settings";
import { resolveTulipIntegrationForStore } from "@/lib/integrations/tulip/state";
import { getCurrentStore } from "@/lib/store-context";

import { EditReservationPageClient } from "./edit-reservation-page-client";
import type { ReservationLocationOption, StoreDeliveryInfo } from "./types";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface EditReservationPageProps {
  params: Promise<{ id: string }>;
}

async function loadEditContext(params: Parameters<typeof getDashboardReservationEditContext>[0]) {
  try {
    return await getDashboardReservationEditContext(params);
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }
}

export default async function EditReservationPage({ params }: EditReservationPageProps) {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const { id } = await params;

  // Reservation, catalogue and availability come through TanStack Query on the
  // client; this server load only seeds the first render.
  const initialContext = await loadEditContext({
    reservationId: id,
    storeId: store.id,
  });

  // Cannot edit completed, cancelled or rejected reservations
  if (!initialContext.editable) {
    redirect(`/dashboard/reservations/${id}`);
  }

  const deliverySettings = (store.settings as Record<string, unknown> | null)?.delivery as
    | DeliverySettings
    | undefined;
  const [activeStoreLocations, tulipIntegration] = await Promise.all([
    deliverySettings?.multiLocationEnabled
      ? db.query.storeLocations.findMany({
          where: and(eq(storeLocations.storeId, store.id), eq(storeLocations.isActive, true)),
          orderBy: (storeLocations, { asc }) => [asc(storeLocations.createdAt)],
        })
      : Promise.resolve([]),
    resolveTulipIntegrationForStore(store.id),
  ]);

  const locationOptions: ReservationLocationOption[] = [
    {
      id: null,
      name: store.name,
      address: store.address ?? null,
      city: null,
      postalCode: null,
      country: store.settings?.country ?? "FR",
    },
    ...activeStoreLocations.map((location) => ({
      id: location.id,
      name: location.name,
      address: location.address,
      city: location.city,
      postalCode: location.postalCode,
      country: location.country,
    })),
  ];

  // Build delivery info from store settings
  const storeDelivery: StoreDeliveryInfo | null =
    deliverySettings?.enabled || deliverySettings?.multiLocationEnabled
      ? {
          settings: deliverySettings,
          latitude: store.latitude ? parseFloat(store.latitude) : null,
          longitude: store.longitude ? parseFloat(store.longitude) : null,
          address: store.address ?? null,
          locations: locationOptions,
        }
      : null;

  return (
    <EditReservationPageClient
      reservationId={id}
      initialContext={initialContext}
      currency={store.settings?.currency || "EUR"}
      tulipInsuranceMode={getDashboardTulipInsuranceModeFromSettings(tulipIntegration.settings)}
      storeSettings={store.settings || null}
      storeDelivery={storeDelivery}
    />
  );
}
