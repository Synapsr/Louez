'use server';

import { revalidatePath } from 'next/cache';

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '@louez/db';
import {
  inspectionItems,
  inspectionPhotos,
  inspections,
  productUnits,
  products,
  reservationActivity,
  reservationItemUnits,
  reservationItems,
  reservations,
} from '@louez/db';
import {
  type CompleteInspectionInput,
  type CreateInspectionInput,
  type SignInspectionInput,
  completeInspectionSchema,
  createInspectionSchema,
  signInspectionSchema,
} from '@louez/validations';

import { getCurrentStore } from '@/lib/store-context';

export interface RepairDowntimeSuggestion {
  units: Array<{
    id: string;
    identifier: string;
    productName: string;
  }>;
}

// ============================================================================
// Create Inspection
// ============================================================================

export async function createInspection(
  data: CreateInspectionInput,
): Promise<{ inspectionId?: string; error?: string }> {
  const store = await getCurrentStore();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = createInspectionSchema.safeParse(data);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const { reservationId, type, templateId, notes, items } = validated.data;

  // Verify reservation belongs to store
  const [reservation] = await db
    .select({ id: reservations.id, customerId: reservations.customerId })
    .from(reservations)
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id),
      ),
    )
    .limit(1);

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  // Check if inspection already exists
  const [existing] = await db
    .select({ id: inspections.id })
    .from(inspections)
    .where(
      and(
        eq(inspections.reservationId, reservationId),
        eq(inspections.type, type),
      ),
    )
    .limit(1);

  if (existing) {
    return { error: 'errors.inspectionAlreadyExists' };
  }

  const inspectionId = nanoid();
  const now = new Date();
  const inspectionItemRows: Array<typeof inspectionItems.$inferInsert> = [];

  // Validate and prepare inspection items before writing the inspection.
  for (const item of items) {
    const itemId = nanoid();

    // Fetch product info for snapshot
    const [reservationItemData] = await db
      .select({
        productName: products.name,
      })
      .from(reservationItems)
      .innerJoin(products, eq(products.id, reservationItems.productId))
      .where(
        and(
          eq(reservationItems.id, item.reservationItemId),
          eq(reservationItems.reservationId, reservationId),
        ),
      )
      .limit(1);

    if (!reservationItemData) {
      return { error: 'errors.invalidData' };
    }

    let unitIdentifier: string | null = null;

    if (item.productUnitId) {
      const [assignedUnit] = await db
        .select({
          identifier: productUnits.identifier,
        })
        .from(reservationItemUnits)
        .innerJoin(
          productUnits,
          eq(productUnits.id, reservationItemUnits.productUnitId),
        )
        .where(
          and(
            eq(reservationItemUnits.reservationItemId, item.reservationItemId),
            eq(reservationItemUnits.productUnitId, item.productUnitId),
          ),
        )
        .limit(1);

      if (!assignedUnit) {
        return { error: 'errors.invalidData' };
      }

      unitIdentifier = assignedUnit.identifier;
    }

    inspectionItemRows.push({
      id: itemId,
      inspectionId,
      reservationItemId: item.reservationItemId,
      productUnitId: item.productUnitId || null,
      productSnapshot: {
        name: reservationItemData.productName,
        ...(unitIdentifier ? { unitIdentifier } : {}),
      },
      overallCondition: item.overallCondition,
      notes: item.notes || null,
      createdAt: now,
    });
  }

  await db.transaction(async (tx) => {
    await tx.insert(inspections).values({
      id: inspectionId,
      storeId: store.id,
      reservationId,
      type,
      status: 'draft',
      templateId: templateId || null,
      notes: notes || null,
      performedById: store.userId,
      performedAt: now,
      hasDamage: false,
    });

    await tx.insert(inspectionItems).values(inspectionItemRows);

    await tx.insert(reservationActivity).values({
      reservationId,
      activityType:
        type === 'departure'
          ? 'inspection_departure_started'
          : 'inspection_return_started',
      userId: store.userId,
    });
  });

  revalidatePath(`/dashboard/reservations/${reservationId}`);

  return { inspectionId };
}

// ============================================================================
// Complete Inspection
// ============================================================================

export async function completeInspection(
  inspectionId: string,
  data: CompleteInspectionInput,
): Promise<{
  success?: boolean;
  repairDowntimeSuggestion?: RepairDowntimeSuggestion;
  error?: string;
}> {
  const store = await getCurrentStore();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = completeInspectionSchema.safeParse(data);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const { notes, hasDamage, damageDescription, estimatedDamageCost } =
    validated.data;

  // Get inspection and verify access
  const [inspection] = await db
    .select({
      id: inspections.id,
      reservationId: inspections.reservationId,
      type: inspections.type,
      status: inspections.status,
    })
    .from(inspections)
    .where(
      and(eq(inspections.id, inspectionId), eq(inspections.storeId, store.id)),
    )
    .limit(1);

  if (!inspection) {
    return { error: 'errors.inspectionNotFound' };
  }

  if (inspection.status !== 'draft') {
    return { error: 'errors.inspectionAlreadyCompleted' };
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(inspections)
      .set({
        status: 'completed',
        notes: notes || null,
        hasDamage,
        damageDescription: damageDescription || null,
        estimatedDamageCost: estimatedDamageCost?.toString() || null,
        updatedAt: now,
      })
      .where(eq(inspections.id, inspectionId));

    await tx.insert(reservationActivity).values({
      reservationId: inspection.reservationId,
      activityType:
        inspection.type === 'departure'
          ? 'inspection_departure_completed'
          : 'inspection_return_completed',
      userId: store.userId,
    });

    if (hasDamage) {
      await tx.insert(reservationActivity).values({
        reservationId: inspection.reservationId,
        activityType: 'inspection_damage_detected',
        userId: store.userId,
        metadata: {
          inspectionId,
          description: damageDescription,
          estimatedCost: estimatedDamageCost,
        },
      });
    }
  });

  let repairDowntimeSuggestion: RepairDowntimeSuggestion | undefined;

  if (inspection.type === 'return') {
    const damagedUnits = await db
      .select({
        id: productUnits.id,
        identifier: productUnits.identifier,
        productName: products.name,
      })
      .from(inspectionItems)
      .innerJoin(
        productUnits,
        eq(productUnits.id, inspectionItems.productUnitId),
      )
      .innerJoin(products, eq(products.id, productUnits.productId))
      .where(
        and(
          eq(inspectionItems.inspectionId, inspectionId),
          eq(inspectionItems.overallCondition, 'damaged'),
          eq(products.storeId, store.id),
        ),
      );

    const damagedUnitsById = new Map<string, (typeof damagedUnits)[number]>();
    for (const unit of damagedUnits) {
      if (!damagedUnitsById.has(unit.id)) {
        damagedUnitsById.set(unit.id, unit);
      }
    }

    const uniqueDamagedUnits = Array.from(damagedUnitsById.values());

    if (uniqueDamagedUnits.length > 0) {
      repairDowntimeSuggestion = { units: uniqueDamagedUnits };
    }
  }

  revalidatePath(`/dashboard/reservations/${inspection.reservationId}`);

  return { success: true, repairDowntimeSuggestion };
}

// ============================================================================
// Sign Inspection
// ============================================================================

export async function signInspection(
  inspectionId: string,
  data: SignInspectionInput,
): Promise<{ success?: boolean; error?: string }> {
  const store = await getCurrentStore();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = signInspectionSchema.safeParse(data);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const { customerSignature } = validated.data;

  // Get inspection and verify access
  const [inspection] = await db
    .select({
      id: inspections.id,
      reservationId: inspections.reservationId,
      status: inspections.status,
    })
    .from(inspections)
    .where(
      and(eq(inspections.id, inspectionId), eq(inspections.storeId, store.id)),
    )
    .limit(1);

  if (!inspection) {
    return { error: 'errors.inspectionNotFound' };
  }

  if (inspection.status === 'signed') {
    return { error: 'errors.inspectionAlreadySigned' };
  }

  const now = new Date();

  // Update inspection with signature
  await db
    .update(inspections)
    .set({
      status: 'signed',
      customerSignature,
      signedAt: now,
      updatedAt: now,
    })
    .where(eq(inspections.id, inspectionId));

  // Log activity
  await db.insert(reservationActivity).values({
    reservationId: inspection.reservationId,
    activityType: 'inspection_signed',
    userId: store.userId,
  });

  revalidatePath(`/dashboard/reservations/${inspection.reservationId}`);

  return { success: true };
}

// ============================================================================
// Get Inspection
// ============================================================================

export async function getInspection(inspectionId: string) {
  const store = await getCurrentStore();
  if (!store) {
    return null;
  }

  const [inspection] = await db
    .select()
    .from(inspections)
    .where(
      and(eq(inspections.id, inspectionId), eq(inspections.storeId, store.id)),
    )
    .limit(1);

  if (!inspection) {
    return null;
  }

  // Get items
  const items = await db
    .select()
    .from(inspectionItems)
    .where(eq(inspectionItems.inspectionId, inspectionId));

  // Get photos
  const photos = await db
    .select()
    .from(inspectionPhotos)
    .where(
      eq(
        inspectionPhotos.inspectionItemId,
        items.length > 0 ? items[0].id : '',
      ),
    );

  return {
    ...inspection,
    items,
    photos,
  };
}

// ============================================================================
// Get Inspections for Reservation
// ============================================================================

export async function getReservationInspections(reservationId: string) {
  const store = await getCurrentStore();
  if (!store) {
    return [];
  }

  const result = await db
    .select()
    .from(inspections)
    .where(
      and(
        eq(inspections.reservationId, reservationId),
        eq(inspections.storeId, store.id),
      ),
    );

  return result;
}

// ============================================================================
// Upload Photo
// ============================================================================

export async function uploadInspectionPhoto(
  inspectionItemId: string,
  photoKey: string,
  photoUrl: string,
  thumbnailKey?: string,
  thumbnailUrl?: string,
  caption?: string,
): Promise<{ photoId?: string; error?: string }> {
  const store = await getCurrentStore();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  // Verify item belongs to store's inspection
  const [item] = await db
    .select({
      id: inspectionItems.id,
      inspectionId: inspectionItems.inspectionId,
    })
    .from(inspectionItems)
    .innerJoin(inspections, eq(inspections.id, inspectionItems.inspectionId))
    .where(
      and(
        eq(inspectionItems.id, inspectionItemId),
        eq(inspections.storeId, store.id),
      ),
    )
    .limit(1);

  if (!item) {
    return { error: 'errors.inspectionItemNotFound' };
  }

  // Get current photo count
  const existingPhotos = await db
    .select({ id: inspectionPhotos.id })
    .from(inspectionPhotos)
    .where(eq(inspectionPhotos.inspectionItemId, inspectionItemId));

  const photoId = nanoid();
  const now = new Date();

  await db.insert(inspectionPhotos).values({
    id: photoId,
    inspectionItemId,
    photoKey,
    photoUrl,
    thumbnailKey: thumbnailKey || null,
    thumbnailUrl: thumbnailUrl || null,
    caption: caption || null,
    displayOrder: existingPhotos.length,
    createdAt: now,
  });

  return { photoId };
}

// ============================================================================
// Delete Photo
// ============================================================================

export async function deleteInspectionPhoto(
  photoId: string,
): Promise<{ success?: boolean; error?: string }> {
  const store = await getCurrentStore();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  // Verify photo belongs to store's inspection
  const [photo] = await db
    .select({
      id: inspectionPhotos.id,
      photoKey: inspectionPhotos.photoKey,
      thumbnailKey: inspectionPhotos.thumbnailKey,
    })
    .from(inspectionPhotos)
    .innerJoin(
      inspectionItems,
      eq(inspectionItems.id, inspectionPhotos.inspectionItemId),
    )
    .innerJoin(inspections, eq(inspections.id, inspectionItems.inspectionId))
    .where(
      and(eq(inspectionPhotos.id, photoId), eq(inspections.storeId, store.id)),
    )
    .limit(1);

  if (!photo) {
    return { error: 'errors.photoNotFound' };
  }

  // Delete from database
  await db.delete(inspectionPhotos).where(eq(inspectionPhotos.id, photoId));

  // Note: Actual file deletion from S3/R2 should be handled separately
  // to avoid orphaned files if deletion fails

  return { success: true };
}
