import { notFound, redirect } from 'next/navigation';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@louez/db';
import {
  customers,
  inspectionItems,
  inspectionPhotos,
  inspections,
  productUnits,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
  stores,
  users,
} from '@louez/db';
import { DEFAULT_INSPECTION_SETTINGS } from '@louez/types';
import type { ConditionRating, InspectionType } from '@louez/types';

import { getCurrentStore } from '@/lib/store-context';

import { InspectionView } from './components/inspection-view';
import { InspectionWizard } from './components/inspection-wizard';

interface PageProps {
  params: Promise<{
    id: string;
    type: string;
  }>;
}

type InspectionWizardItem = {
  id: string;
  reservationItemId: string;
  quantity: number;
  productUnitId: string | null;
  unitIdentifier: string | null;
  product: {
    id: string;
    name: string;
    images: string[];
  };
};

export default async function InspectionPage({ params }: PageProps) {
  const { id: reservationId, type } = await params;

  // Validate type
  if (type !== 'departure' && type !== 'return') {
    notFound();
  }

  const inspectionType = type as InspectionType;

  const store = await getCurrentStore();
  if (!store) {
    redirect('/login');
  }

  // Get store settings
  const [storeData] = await db
    .select({ settings: stores.settings })
    .from(stores)
    .where(eq(stores.id, store.id))
    .limit(1);

  const settings = storeData?.settings as {
    inspection?: typeof DEFAULT_INSPECTION_SETTINGS;
  } | null;
  const inspectionSettings =
    settings?.inspection || DEFAULT_INSPECTION_SETTINGS;

  // Check if inspections are enabled
  if (!inspectionSettings.enabled) {
    redirect(`/dashboard/reservations/${reservationId}`);
  }

  // Get reservation
  const [reservation] = await db
    .select({
      id: reservations.id,
      number: reservations.number,
      status: reservations.status,
      customerId: reservations.customerId,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id),
      ),
    )
    .limit(1);

  if (!reservation) {
    notFound();
  }

  // Get customer
  const [customer] = await db
    .select({
      id: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(customers)
    .where(eq(customers.id, reservation.customerId))
    .limit(1);

  const customerName = customer
    ? `${customer.firstName} ${customer.lastName}`
    : 'Client';

  // Check if inspection already exists
  const [existingInspection] = await db
    .select({
      id: inspections.id,
      type: inspections.type,
      status: inspections.status,
      hasDamage: inspections.hasDamage,
      notes: inspections.notes,
      performedById: inspections.performedById,
      createdAt: inspections.createdAt,
      signedAt: inspections.signedAt,
      customerSignature: inspections.customerSignature,
    })
    .from(inspections)
    .where(
      and(
        eq(inspections.reservationId, reservationId),
        eq(inspections.type, inspectionType),
      ),
    )
    .limit(1);

  // If inspection exists, show the view
  if (existingInspection) {
    // Get performer name
    let performedByName: string | null = null;
    if (existingInspection.performedById) {
      const [performer] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, existingInspection.performedById))
        .limit(1);
      performedByName = performer?.name || null;
    }

    // Get inspection items with photos
    const items = await db
      .select({
        id: inspectionItems.id,
        productSnapshot: inspectionItems.productSnapshot,
        overallCondition: inspectionItems.overallCondition,
        notes: inspectionItems.notes,
      })
      .from(inspectionItems)
      .where(eq(inspectionItems.inspectionId, existingInspection.id));

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
        };
        const productName = productSnapshot?.unitIdentifier
          ? `${productSnapshot.name || 'Équipement'} — ${productSnapshot.unitIdentifier}`
          : productSnapshot?.name || 'Équipement';

        return {
          id: item.id,
          productName,
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

    return (
      <InspectionView
        inspection={{
          id: existingInspection.id,
          type: existingInspection.type as InspectionType,
          status: existingInspection.status as 'draft' | 'completed' | 'signed',
          hasDamage: existingInspection.hasDamage,
          notes: existingInspection.notes,
          performedByName,
          createdAt: existingInspection.createdAt,
          signedAt: existingInspection.signedAt,
          customerSignature: existingInspection.customerSignature,
          items: itemsWithPhotos,
        }}
        reservationId={reservationId}
        reservationNumber={reservation.number}
        customerName={customerName}
      />
    );
  }

  // Validate reservation status for creating new inspection
  if (inspectionType === 'departure' && reservation.status !== 'confirmed') {
    redirect(`/dashboard/reservations/${reservationId}`);
  }

  if (inspectionType === 'return' && reservation.status !== 'ongoing') {
    redirect(`/dashboard/reservations/${reservationId}`);
  }

  // Get reservation items with products for wizard
  const reservationItemsData = await db
    .select({
      id: reservationItems.id,
      quantity: reservationItems.quantity,
      productId: reservationItems.productId,
      productName: products.name,
      productImages: products.images,
    })
    .from(reservationItems)
    .innerJoin(products, eq(products.id, reservationItems.productId))
    .where(eq(reservationItems.reservationId, reservationId));

  const reservationItemIds = reservationItemsData.map((item) => item.id);
  const assignedUnits =
    reservationItemIds.length > 0
      ? await db
          .select({
            reservationItemId: reservationItemUnits.reservationItemId,
            productUnitId: productUnits.id,
            identifier: productUnits.identifier,
          })
          .from(reservationItemUnits)
          .innerJoin(
            productUnits,
            eq(productUnits.id, reservationItemUnits.productUnitId),
          )
          .where(
            inArray(reservationItemUnits.reservationItemId, reservationItemIds),
          )
      : [];

  const assignedUnitsByItemId = new Map<
    string,
    Array<{ productUnitId: string; identifier: string }>
  >();

  for (const unit of assignedUnits) {
    const units = assignedUnitsByItemId.get(unit.reservationItemId) ?? [];
    units.push({
      productUnitId: unit.productUnitId,
      identifier: unit.identifier,
    });
    assignedUnitsByItemId.set(unit.reservationItemId, units);
  }

  const formattedItems = reservationItemsData
    .filter((item) => item.productId !== null)
    .flatMap<InspectionWizardItem>((item) => {
      const product = {
        id: item.productId as string,
        name: item.productName,
        images: (item.productImages as string[]) || [],
      };
      const itemAssignedUnits = assignedUnitsByItemId.get(item.id) ?? [];

      if (itemAssignedUnits.length === 0) {
        return [
          {
            id: item.id,
            reservationItemId: item.id,
            quantity: item.quantity,
            productUnitId: null,
            unitIdentifier: null,
            product,
          },
        ];
      }

      const unitRows = itemAssignedUnits.map((unit) => ({
        id: `${item.id}-${unit.productUnitId}`,
        reservationItemId: item.id,
        quantity: 1,
        productUnitId: unit.productUnitId,
        unitIdentifier: unit.identifier,
        product,
      }));

      const unassignedQuantity = item.quantity - itemAssignedUnits.length;
      if (unassignedQuantity <= 0) {
        return unitRows;
      }

      return [
        ...unitRows,
        {
          id: item.id,
          reservationItemId: item.id,
          quantity: unassignedQuantity,
          productUnitId: null,
          unitIdentifier: null,
          product,
        },
      ];
    });

  return (
    <InspectionWizard
      reservationId={reservationId}
      reservationNumber={reservation.number}
      customerName={customerName}
      type={inspectionType}
      items={formattedItems}
      requireSignature={inspectionSettings.requireCustomerSignature}
      maxPhotosPerItem={inspectionSettings.maxPhotosPerItem}
    />
  );
}
