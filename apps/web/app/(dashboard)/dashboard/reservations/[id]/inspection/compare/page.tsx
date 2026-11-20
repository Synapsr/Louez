import { notFound, redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@louez/db";
import { reservations, inspections, inspectionItems, inspectionPhotos, customers } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";
import { ComparisonView } from "./comparison-view";
import type { ConditionRating } from "@louez/types";
import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";
import { getReservationApplicantName } from "@/lib/reservations/util.reservation-applicant";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InspectionComparePage({ params }: PageProps) {
  const { id: reservationId } = await params;

  const store = await getCurrentStore();
  if (!store) {
    redirect("/login");
  }

  // Get reservation
  const [reservation] = await db
    .select({
      id: reservations.id,
      number: reservations.number,
      customerId: reservations.customerId,
      bookedByName: reservations.bookedByName,
    })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)))
    .limit(1);

  if (!reservation) {
    notFound();
  }

  const tInspection = await getTranslations("dashboard.settings.inspection");

  // Get customer name
  const [customer] = await db
    .select({
      firstName: customers.firstName,
      lastName: customers.lastName,
      companyName: customers.companyName,
    })
    .from(customers)
    .where(eq(customers.id, reservation.customerId))
    .limit(1);

  const customerName = getReservationApplicantName(reservation.bookedByName, customer);

  // Get both inspections
  const reservationInspections = await db
    .select({
      id: inspections.id,
      type: inspections.type,
      status: inspections.status,
      hasDamage: inspections.hasDamage,
      notes: inspections.notes,
      createdAt: inspections.createdAt,
      signedAt: inspections.signedAt,
      customerSignature: inspections.customerSignature,
      issuerSignature: inspections.issuerSignature,
    })
    .from(inspections)
    .where(eq(inspections.reservationId, reservationId));

  const departureInspection = reservationInspections.find((i) => i.type === "departure");
  const returnInspection = reservationInspections.find((i) => i.type === "return");

  // Need at least one inspection
  if (!departureInspection && !returnInspection) {
    redirect(`/dashboard/reservations/${reservationId}`);
  }

  // Get items with photos for each inspection
  const getInspectionData = async (inspectionId: string | undefined) => {
    if (!inspectionId) return null;

    const items = await db
      .select({
        id: inspectionItems.id,
        productSnapshot: inspectionItems.productSnapshot,
        overallCondition: inspectionItems.overallCondition,
        notes: inspectionItems.notes,
      })
      .from(inspectionItems)
      .where(eq(inspectionItems.inspectionId, inspectionId));

    // Get photos for each item
    const itemsWithPhotos = await Promise.all(
      items.map(async (item) => {
        const photos = await db
          .select({
            id: inspectionPhotos.id,
            photoUrl: inspectionPhotos.photoUrl,
            thumbnailUrl: inspectionPhotos.thumbnailUrl,
            caption: inspectionPhotos.caption,
          })
          .from(inspectionPhotos)
          .where(eq(inspectionPhotos.inspectionItemId, item.id));

        const productSnapshot = item.productSnapshot as {
          name?: string;
          unitIdentifier?: string | null;
        } | null;
        const productName = productSnapshot?.name || "Équipement";
        const unitIdentifier = productSnapshot?.unitIdentifier ?? null;

        return {
          id: item.id,
          productName,
          unitIdentifier,
          condition: item.overallCondition as ConditionRating,
          notes: item.notes,
          photos: photos.map((p) => ({
            id: p.id,
            url: p.photoUrl,
            thumbnailUrl: p.thumbnailUrl,
            caption: p.caption,
          })),
        };
      }),
    );

    return itemsWithPhotos;
  };

  const departureItems = departureInspection
    ? await getInspectionData(departureInspection.id)
    : null;
  const returnItems = returnInspection ? await getInspectionData(returnInspection.id) : null;

  // Format data for comparison view
  const formattedDeparture =
    departureInspection && departureItems
      ? {
          id: departureInspection.id,
          type: "departure" as const,
          status: departureInspection.status as "draft" | "completed" | "signed",
          hasDamage: departureInspection.hasDamage,
          notes: departureInspection.notes,
          createdAt: departureInspection.createdAt,
          signedAt: departureInspection.signedAt,
          hasSignature:
            !!departureInspection.customerSignature && !!departureInspection.issuerSignature,
          items: departureItems,
        }
      : null;

  const formattedReturn =
    returnInspection && returnItems
      ? {
          id: returnInspection.id,
          type: "return" as const,
          status: returnInspection.status as "draft" | "completed" | "signed",
          hasDamage: returnInspection.hasDamage,
          notes: returnInspection.notes,
          createdAt: returnInspection.createdAt,
          signedAt: returnInspection.signedAt,
          hasSignature: !!returnInspection.customerSignature && !!returnInspection.issuerSignature,
          items: returnItems,
        }
      : null;

  return (
    <>
      <DashboardBreadcrumbLabel
        pathname={`/dashboard/reservations/${reservationId}`}
        label={`#${reservation.number}`}
      />
      <DashboardBreadcrumbLabel label={tInspection("comparison.title")} />
      <ComparisonView
        reservationId={reservationId}
        reservationNumber={reservation.number}
        customerName={customerName}
        departure={formattedDeparture}
        return_={formattedReturn}
      />
    </>
  );
}
