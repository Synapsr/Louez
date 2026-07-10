'use server';

import { revalidatePath } from 'next/cache';

import { and, eq, gte, inArray, ne, not, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db, getEffectiveProductQuantities } from '@louez/db';
import {
  categories,
  getBlockingReservationStatuses,
  productAccessories,
  productPricingTiers,
  productUnits,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
} from '@louez/db';
import type { BookingAttributeAxis, UnitAttributes } from '@louez/types';
import {
  DEFAULT_COMBINATION_KEY,
  buildCombinationKey,
  canonicalizeAttributes,
  normalizeAxisKey,
  priceDurationToMinutes,
  pricingModeToMinutes,
  validatePricingTiers,
} from '@louez/utils';
import {
  type CategoryInput,
  type ProductInput,
  type ProductUnitInput,
  categorySchema,
  productSchema,
} from '@louez/validations';

import { auth } from '@/lib/auth';
import {
  notifyProductCreated,
  notifyProductUpdated,
} from '@/lib/discord/platform-notifications';
import { captureProductServerEvent } from '@/lib/product-analytics/analytics';
import { productAnalyticsEvents } from '@/lib/product-analytics/analytics-events';
import { getCurrentStore } from '@/lib/store-context';
import {
  type UpdateUnitMutation,
  createUnits,
  deleteUnits,
  updateUnits,
} from '@/lib/utils/unit-mutations';

async function getStoreForUser() {
  return getCurrentStore();
}

async function getActorUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

const UNIT_LIFECYCLE = {
  active: 'active',
} satisfies { active: 'active' };

function normalizeBookingAttributeAxes(
  axes: ProductInput['bookingAttributeAxes'],
): BookingAttributeAxis[] {
  if (!axes || axes.length === 0) {
    return [];
  }

  return axes
    .map((axis, index) => ({
      key: normalizeAxisKey(axis.key),
      label: axis.label.trim(),
      position: index,
    }))
    .filter((axis) => axis.key.length > 0 && axis.label.length > 0);
}

function resolveUnitAttributes(
  axes: BookingAttributeAxis[],
  unit: ProductUnitInput,
): UnitAttributes {
  return canonicalizeAttributes(
    axes,
    unit.attributes as UnitAttributes | undefined,
  );
}

function normalizePriceInput(value: string | undefined): string {
  return (value || '0').replace(',', '.');
}

function normalizeNullablePriceInput(
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }

  return value.trim().replace(',', '.') || null;
}

function normalizeNullableDateInput(
  value: string | Date | null | undefined,
): Date | null {
  if (!value) {
    return null;
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

function getNewUnitNotesInput(unit: ProductUnitInput): string | undefined {
  return 'notes' in unit ? unit.notes : undefined;
}

function getNewUnitPurchasePriceInput(
  unit: ProductUnitInput,
): string | null | undefined {
  return 'purchasePrice' in unit ? unit.purchasePrice : undefined;
}

function getNewUnitPurchasedAtInput(
  unit: ProductUnitInput,
): string | Date | null | undefined {
  return 'purchasedAt' in unit ? unit.purchasedAt : undefined;
}

async function getAssignedBlockingUnitIds({
  unitIds,
  storeId,
  pendingBlocksAvailability,
}: {
  unitIds: string[];
  storeId: string;
  pendingBlocksAvailability: boolean;
}): Promise<string[]> {
  if (unitIds.length === 0) {
    return [];
  }

  const blockingStatuses = getBlockingReservationStatuses(
    pendingBlocksAvailability,
  );
  const rows = await db
    .select({ productUnitId: reservationItemUnits.productUnitId })
    .from(reservationItemUnits)
    .innerJoin(
      reservationItems,
      eq(reservationItemUnits.reservationItemId, reservationItems.id),
    )
    .innerJoin(
      reservations,
      eq(reservationItems.reservationId, reservations.id),
    )
    .where(
      and(
        inArray(reservationItemUnits.productUnitId, unitIds),
        eq(reservations.storeId, storeId),
        inArray(reservations.status, blockingStatuses),
      ),
    );

  return [
    ...new Set(
      rows.flatMap((row) => (row.productUnitId ? [row.productUnitId] : [])),
    ),
  ];
}

function getLegacyPricingModeFromUnit(
  unit: 'minute' | 'hour' | 'day' | 'week',
): 'hour' | 'day' | 'week' {
  if (unit === 'week') return 'week';
  if (unit === 'day') return 'day';
  return 'hour';
}

function buildRateTierRows(
  input: ProductInput,
  basePrice: number,
  basePeriodMinutes: number,
): Array<{
  id?: string;
  period: number;
  price: string;
  minDuration: number | null;
  discountPercent: string | null;
}> {
  if (Array.isArray(input.rateTiers)) {
    const rows = input.rateTiers.map((tier) => {
      const period = priceDurationToMinutes(tier.duration, tier.unit);
      const tierPrice = normalizePriceInput(tier.price);

      return {
        id: tier.id,
        period,
        price: tierPrice,
        // Legacy compatibility columns are intentionally not persisted.
        minDuration: null,
        discountPercent: null,
      };
    });

    return rows.sort((a, b) => a.period - b.period);
  }

  // Backward fallback for legacy payloads.
  const legacyTiers = input.pricingTiers || [];
  const rows = legacyTiers.map((tier) => {
    const period = tier.minDuration * basePeriodMinutes;
    const unitPrice = basePrice * (1 - tier.discountPercent / 100);
    const totalPrice = unitPrice * tier.minDuration;
    return {
      id: tier.id,
      period,
      price: totalPrice.toFixed(2),
      minDuration: null,
      discountPercent: null,
    };
  });

  return rows.sort((a, b) => a.period - b.period);
}

function hasDuplicateRatePeriods(rows: Array<{ period: number }>): boolean {
  const periods = new Set<number>();
  for (const row of rows) {
    if (periods.has(row.period)) {
      return true;
    }
    periods.add(row.period);
  }
  return false;
}

function getDuplicateRatePeriodIndexes(
  rows: Array<{ period: number }>,
): number[] {
  const byPeriod = new Map<number, number[]>();

  rows.forEach((row, index) => {
    const existing = byPeriod.get(row.period);
    if (existing) {
      existing.push(index);
      return;
    }
    byPeriod.set(row.period, [index]);
  });

  const duplicateIndexes = new Set<number>();
  for (const indexes of byPeriod.values()) {
    if (indexes.length < 2) continue;
    indexes.forEach((index) => duplicateIndexes.add(index));
  }

  return Array.from(duplicateIndexes).sort((a, b) => a - b);
}

export async function createProduct(data: ProductInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = productSchema.safeParse(data);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  // Validate legacy pricing tiers if provided (fallback compatibility only)
  const pricingTiers = validated.data.pricingTiers || [];
  if (validated.data.rateTiers == null && pricingTiers.length > 0) {
    const tierValidation = validatePricingTiers(pricingTiers);
    if (!tierValidation.valid) {
      return { error: tierValidation.error };
    }
  }

  const basePriceDuration = validated.data.basePriceDuration;
  const price = normalizePriceInput(
    basePriceDuration?.price || validated.data.price,
  );
  const basePeriodMinutes = basePriceDuration
    ? priceDurationToMinutes(basePriceDuration.duration, basePriceDuration.unit)
    : pricingModeToMinutes(
        (validated.data.pricingMode || 'day') as 'hour' | 'day' | 'week',
      );
  const legacyPricingMode = basePriceDuration
    ? getLegacyPricingModeFromUnit(basePriceDuration.unit)
    : ((validated.data.pricingMode || 'day') as 'hour' | 'day' | 'week');
  const deposit = validated.data.deposit
    ? normalizePriceInput(validated.data.deposit)
    : '0';
  const rateTierRows = buildRateTierRows(
    validated.data,
    parseFloat(price) || 0,
    basePeriodMinutes,
  );
  if (hasDuplicateRatePeriods(rateTierRows)) {
    return {
      error: 'errors.invalidData',
      details: {
        code: 'duplicate_rate_periods',
        duplicateRateTierIndexes: getDuplicateRatePeriodIndexes(rateTierRows),
      },
    };
  }

  // Unit tracking
  const trackUnits = validated.data.trackUnits || false;
  const units = validated.data.units || [];
  const bookingAttributeAxes = trackUnits
    ? normalizeBookingAttributeAxes(validated.data.bookingAttributeAxes)
    : [];
  const manualQuantity = parseInt(validated.data.quantity, 10);

  const productId = nanoid();
  const actorUserId =
    trackUnits && units.length > 0 ? await getActorUserId() : null;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(products).values({
        id: productId,
        storeId: store.id,
        name: validated.data.name,
        description: validated.data.description || null,
        aiContext: validated.data.aiContext?.trim()
          ? validated.data.aiContext.trim()
          : null,
        categoryId: validated.data.categoryId || null,
        price: price,
        deposit: deposit,
        pricingMode: legacyPricingMode,
        basePeriodMinutes,
        ...(!trackUnits ? { quantity: manualQuantity } : {}),
        status: validated.data.status,
        images: validated.data.images || [],
        videoUrl: validated.data.videoUrl || null,
        taxSettings: validated.data.taxSettings || null,
        enforceStrictTiers: validated.data.enforceStrictTiers || false,
        trackUnits: trackUnits,
        bookingAttributeAxes:
          trackUnits && bookingAttributeAxes.length > 0
            ? bookingAttributeAxes
            : null,
      });

      // Create pricing tiers if provided
      if (rateTierRows.length > 0) {
        await tx.insert(productPricingTiers).values(
          rateTierRows.map((tier, index) => ({
            id: nanoid(),
            productId: productId,
            minDuration: tier.minDuration,
            discountPercent: tier.discountPercent,
            period: tier.period,
            price: tier.price,
            displayOrder: index,
          })),
        );
      }

      // Create units if tracking is enabled
      if (trackUnits && units.length > 0) {
        const unitRows = units.map((unit) => {
          const attributes = resolveUnitAttributes(bookingAttributeAxes, unit);

          return {
            attributes,
            combinationKey: buildCombinationKey(
              bookingAttributeAxes,
              attributes,
            ),
            id: nanoid(),
            productId: productId,
            identifier: unit.identifier.trim(),
            notes: getNewUnitNotesInput(unit)?.trim() || null,
            purchasePrice: normalizeNullablePriceInput(
              getNewUnitPurchasePriceInput(unit),
            ),
            purchasedAt: normalizeNullableDateInput(
              getNewUnitPurchasedAtInput(unit),
            ),
            lifecycleStatus: UNIT_LIFECYCLE.active,
          };
        });

        await createUnits(
          tx,
          unitRows.map((unit) => ({
            unit,
            event: {
              storeId: store.id,
              actorUserId,
              identifierSnapshot: unit.identifier,
              payload: {
                productId,
                identifier: unit.identifier,
                combinationKey: unit.combinationKey,
              },
            },
          })),
        );
      }
    });
  } catch (error) {
    console.error('Error creating product:', error);
    return { error: 'errors.invalidData' };
  }

  notifyProductCreated(
    { id: store.id, name: store.name, slug: store.slug },
    validated.data.name,
  ).catch(() => {});

  await captureProductServerEvent({
    distinctId: store.userId,
    event: productAnalyticsEvents.productCreated,
    properties: {
      feature: 'product_catalog',
      surface: 'dashboard',
      store_id: store.id,
      product_id: productId,
      product_status: validated.data.status,
      created_from: 'dashboard',
      track_units: trackUnits,
      available_unit_count: trackUnits ? units.length : null,
      manual_quantity: trackUnits ? null : manualQuantity,
      has_category: Boolean(validated.data.categoryId),
      image_count: validated.data.images?.length ?? 0,
      has_video: Boolean(validated.data.videoUrl),
      has_rate_tiers: rateTierRows.length > 0,
      rate_tier_count: rateTierRows.length,
      has_deposit: parseFloat(deposit) > 0,
      base_period_minutes: basePeriodMinutes,
      pricing_mode: legacyPricingMode,
      booking_attribute_axis_count: bookingAttributeAxes.length,
    },
  });

  revalidatePath('/dashboard/products');
  revalidatePath('/dashboard/inventory');
  return { success: true, productId };
}

export async function updateProduct(productId: string, data: ProductInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = productSchema.safeParse(data);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  // Validate legacy pricing tiers only when V2 rates are not provided.
  const pricingTiers = validated.data.pricingTiers || [];
  if (validated.data.rateTiers == null && pricingTiers.length > 0) {
    const tierValidation = validatePricingTiers(pricingTiers);
    if (!tierValidation.valid) {
      return { error: tierValidation.error };
    }
  }

  // Verify product belongs to store
  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
  });

  if (!product) {
    return { error: 'errors.productNotFound' };
  }

  const basePriceDuration = validated.data.basePriceDuration;
  const price = normalizePriceInput(
    basePriceDuration?.price || validated.data.price,
  );
  const basePeriodMinutes = basePriceDuration
    ? priceDurationToMinutes(basePriceDuration.duration, basePriceDuration.unit)
    : pricingModeToMinutes(
        (validated.data.pricingMode || product.pricingMode || 'day') as
          | 'hour'
          | 'day'
          | 'week',
      );
  const legacyPricingMode = basePriceDuration
    ? getLegacyPricingModeFromUnit(basePriceDuration.unit)
    : ((validated.data.pricingMode || product.pricingMode || 'day') as
        | 'hour'
        | 'day'
        | 'week');
  const deposit = validated.data.deposit
    ? normalizePriceInput(validated.data.deposit)
    : '0';
  const rateTierRows = buildRateTierRows(
    validated.data,
    parseFloat(price) || 0,
    basePeriodMinutes,
  );
  if (hasDuplicateRatePeriods(rateTierRows)) {
    return {
      error: 'errors.invalidData',
      details: {
        code: 'duplicate_rate_periods',
        duplicateRateTierIndexes: getDuplicateRatePeriodIndexes(rateTierRows),
      },
    };
  }

  // Unit tracking
  const trackUnits = validated.data.trackUnits || false;
  const units = validated.data.units || [];
  const bookingAttributeAxes = trackUnits
    ? normalizeBookingAttributeAxes(validated.data.bookingAttributeAxes)
    : [];
  const blockingStatuses = getBlockingReservationStatuses(
    store.settings?.pendingBlocksAvailability ?? true,
  );

  // Prevent disabling unit tracking when future/active reservations use non-default combinations.
  if (!trackUnits && product.trackUnits) {
    const conflictingVariantReservations = await db
      .select({ id: reservationItems.id })
      .from(reservationItems)
      .innerJoin(
        reservations,
        eq(reservationItems.reservationId, reservations.id),
      )
      .where(
        and(
          eq(reservationItems.productId, productId),
          not(eq(reservationItems.combinationKey, DEFAULT_COMBINATION_KEY)),
          inArray(reservations.status, blockingStatuses),
          gte(reservations.endDate, new Date()),
        ),
      )
      .limit(1);

    if (conflictingVariantReservations.length > 0) {
      return { error: 'errors.cannotDisableUnitTrackingWithCombinations' };
    }
  }

  const existingUnits =
    trackUnits || product.trackUnits
      ? await db.query.productUnits.findMany({
          where: eq(productUnits.productId, productId),
        })
      : [];
  const editableExistingUnits = existingUnits.filter(
    (unit) => unit.lifecycleStatus === UNIT_LIFECYCLE.active,
  );
  const existingUnitsById = new Map(
    editableExistingUnits.map((unit) => [unit.id, unit]),
  );
  const existingUnitIds = new Set(editableExistingUnits.map((unit) => unit.id));
  const unitsToUpdate = units.filter(
    (unit) => unit.id && existingUnitIds.has(unit.id),
  );
  const unitsToInsert = units.filter((unit) => !unit.id);
  const unitIdsToKeep = new Set(
    trackUnits
      ? units.flatMap((unit) =>
          unit.id && existingUnitIds.has(unit.id) ? [unit.id] : [],
        )
      : [],
  );
  const unitsToDelete = editableExistingUnits.filter(
    (unit) => !unitIdsToKeep.has(unit.id),
  );
  const manualQuantity = parseInt(validated.data.quantity, 10);

  if (unitsToDelete.length > 0) {
    const failedUnitIds = await getAssignedBlockingUnitIds({
      unitIds: unitsToDelete.map((unit) => unit.id),
      storeId: store.id,
      pendingBlocksAvailability:
        store.settings?.pendingBlocksAvailability ?? true,
    });

    if (failedUnitIds.length > 0) {
      return { error: 'errors.unitAssigned', failedUnitIds };
    }
  }

  // Prevent edits that would make active unit capacity lower than
  // active/future reserved quantities for any combination.
  if (trackUnits) {
    const proposedAvailableByCombination = new Map<string, number>();

    for (const unit of unitsToUpdate) {
      if (!unit.id) continue;
      const existingUnit = existingUnitsById.get(unit.id);
      if (existingUnit?.lifecycleStatus !== 'active') continue;

      const attributes = resolveUnitAttributes(bookingAttributeAxes, unit);
      const combinationKey = buildCombinationKey(
        bookingAttributeAxes,
        attributes,
      );
      proposedAvailableByCombination.set(
        combinationKey,
        (proposedAvailableByCombination.get(combinationKey) || 0) + 1,
      );
    }

    for (const unit of unitsToInsert) {
      const attributes = resolveUnitAttributes(bookingAttributeAxes, unit);
      const combinationKey = buildCombinationKey(
        bookingAttributeAxes,
        attributes,
      );
      proposedAvailableByCombination.set(
        combinationKey,
        (proposedAvailableByCombination.get(combinationKey) || 0) + 1,
      );
    }

    const reservedRows = await db
      .select({
        combinationKey: reservationItems.combinationKey,
        quantity: reservationItems.quantity,
      })
      .from(reservationItems)
      .innerJoin(
        reservations,
        eq(reservationItems.reservationId, reservations.id),
      )
      .where(
        and(
          eq(reservationItems.productId, productId),
          inArray(reservations.status, blockingStatuses),
          gte(reservations.endDate, new Date()),
        ),
      );

    const reservedByCombination = new Map<string, number>();
    for (const row of reservedRows) {
      const combinationKey = row.combinationKey || DEFAULT_COMBINATION_KEY;
      reservedByCombination.set(
        combinationKey,
        (reservedByCombination.get(combinationKey) || 0) + row.quantity,
      );
    }

    const hasCapacityConflict = [...reservedByCombination.entries()].some(
      ([combinationKey, reservedQty]) => {
        const availableQty =
          proposedAvailableByCombination.get(combinationKey) || 0;
        return reservedQty > availableQty;
      },
    );

    if (hasCapacityConflict) {
      return { error: 'errors.unitStatusConflictsWithReservations' };
    }
  }

  await db
    .update(products)
    .set({
      name: validated.data.name,
      description: validated.data.description || null,
      aiContext: validated.data.aiContext?.trim()
        ? validated.data.aiContext.trim()
        : null,
      categoryId: validated.data.categoryId || null,
      price: price,
      deposit: deposit,
      pricingMode: legacyPricingMode,
      basePeriodMinutes,
      ...(!trackUnits ? { quantity: manualQuantity } : {}),
      status: validated.data.status,
      images: validated.data.images || [],
      videoUrl: validated.data.videoUrl || null,
      taxSettings: validated.data.taxSettings || null,
      enforceStrictTiers: validated.data.enforceStrictTiers || false,
      trackUnits: trackUnits,
      bookingAttributeAxes:
        trackUnits && bookingAttributeAxes.length > 0
          ? bookingAttributeAxes
          : null,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));

  // Update pricing tiers: delete all existing and insert new ones
  await db
    .delete(productPricingTiers)
    .where(eq(productPricingTiers.productId, productId));

  if (rateTierRows.length > 0) {
    await db.insert(productPricingTiers).values(
      rateTierRows.map((tier, index) => ({
        id: tier.id || nanoid(),
        productId: productId,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent,
        period: tier.period,
        price: tier.price,
        displayOrder: index,
      })),
    );
  }

  // Update product units: sync with provided units
  if (trackUnits || product.trackUnits) {
    const actorUserId =
      unitsToDelete.length > 0 ||
      unitsToUpdate.length > 0 ||
      unitsToInsert.length > 0
        ? await getActorUserId()
        : null;

    const updateMutations: UpdateUnitMutation[] = unitsToUpdate.flatMap(
      (unit) => {
        if (!unit.id) return [];
        const existingUnit = existingUnitsById.get(unit.id);
        if (!existingUnit) return [];

        const identifier = unit.identifier.trim();
        const attributes = resolveUnitAttributes(bookingAttributeAxes, unit);
        const combinationKey = buildCombinationKey(
          bookingAttributeAxes,
          attributes,
        );
        const changes: Record<string, { from: unknown; to: unknown }> = {};

        if (identifier !== existingUnit.identifier) {
          changes.identifier = {
            from: existingUnit.identifier,
            to: identifier,
          };
        }

        if (combinationKey !== existingUnit.combinationKey) {
          changes.combinationKey = {
            from: existingUnit.combinationKey,
            to: combinationKey,
          };
        }

        if (
          JSON.stringify(attributes) !==
          JSON.stringify(existingUnit.attributes ?? {})
        ) {
          changes.attributes = {
            from: existingUnit.attributes ?? {},
            to: attributes,
          };
        }

        if (Object.keys(changes).length === 0) {
          return [];
        }

        return [
          {
            unitId: unit.id,
            values: {
              identifier,
              attributes,
              combinationKey,
            },
            event: {
              storeId: store.id,
              type: 'updated',
              actorUserId,
              identifierSnapshot: identifier,
              payload: { changes },
            },
          },
        ];
      },
    );

    const unitRows = unitsToInsert.map((unit) => {
      const attributes = resolveUnitAttributes(bookingAttributeAxes, unit);
      return {
        id: nanoid(),
        productId: productId,
        identifier: unit.identifier.trim(),
        notes: getNewUnitNotesInput(unit)?.trim() || null,
        purchasePrice: normalizeNullablePriceInput(
          getNewUnitPurchasePriceInput(unit),
        ),
        purchasedAt: normalizeNullableDateInput(
          getNewUnitPurchasedAtInput(unit),
        ),
        lifecycleStatus: UNIT_LIFECYCLE.active,
        attributes,
        combinationKey: buildCombinationKey(bookingAttributeAxes, attributes),
      };
    });

    await db.transaction(async (tx) => {
      await deleteUnits(
        tx,
        unitsToDelete.map((unit) => ({
          unitId: unit.id,
          event: {
            storeId: store.id,
            type: 'deleted',
            actorUserId,
            identifierSnapshot: unit.identifier,
            payload: {
              productId,
              identifier: unit.identifier,
              combinationKey: unit.combinationKey,
            },
          },
        })),
      );
      await updateUnits(tx, updateMutations);
      await createUnits(
        tx,
        unitRows.map((unit) => ({
          unit,
          event: {
            storeId: store.id,
            actorUserId,
            identifierSnapshot: unit.identifier,
            payload: {
              productId,
              identifier: unit.identifier,
              combinationKey: unit.combinationKey,
            },
          },
        })),
      );
    });
  }

  // Update accessories: delete all existing and insert new ones
  const accessoryIds = validated.data.accessoryIds || [];
  await db
    .delete(productAccessories)
    .where(eq(productAccessories.productId, productId));

  if (accessoryIds.length > 0) {
    // Verify all accessories belong to the same store and are not the product itself
    const validAccessories = await db.query.products.findMany({
      where: and(
        eq(products.storeId, store.id),
        inArray(products.id, accessoryIds),
        ne(products.id, productId),
      ),
      columns: { id: true },
    });

    const validAccessoryIds = validAccessories.map((a) => a.id);

    if (validAccessoryIds.length > 0) {
      await db.insert(productAccessories).values(
        validAccessoryIds.map((accessoryId, index) => ({
          id: nanoid(),
          productId: productId,
          accessoryId: accessoryId,
          displayOrder: index,
        })),
      );
    }
  }

  notifyProductUpdated(
    { id: store.id, name: store.name, slug: store.slug },
    validated.data.name,
  ).catch(() => {});

  revalidatePath('/dashboard/products');
  revalidatePath('/dashboard/inventory');
  revalidatePath(`/dashboard/products/${productId}`);
  return { success: true };
}

export async function updateProductStatus(
  productId: string,
  status: 'draft' | 'active' | 'archived',
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
  });

  if (!product) {
    return { error: 'errors.productNotFound' };
  }

  await db
    .update(products)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));

  revalidatePath('/dashboard/products');
  return { success: true };
}

export async function deleteProduct(productId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
  });

  if (!product) {
    return { error: 'errors.productNotFound' };
  }

  const unitsToDelete = await db.query.productUnits.findMany({
    where: eq(productUnits.productId, productId),
  });
  const failedUnitIds = await getAssignedBlockingUnitIds({
    unitIds: unitsToDelete.map((unit) => unit.id),
    storeId: store.id,
    pendingBlocksAvailability:
      store.settings?.pendingBlocksAvailability ?? true,
  });

  if (failedUnitIds.length > 0) {
    return {
      error: 'errors.unitAssigned',
      failedUnitIds,
      failedUnitIdentifiers: unitsToDelete
        .filter((unit) => failedUnitIds.includes(unit.id))
        .map((unit) => unit.identifier),
    };
  }

  const actorUserId = unitsToDelete.length > 0 ? await getActorUserId() : null;

  await db.transaction(async (tx) => {
    // Delete accessory relations (both as product and as accessory)
    await tx
      .delete(productAccessories)
      .where(
        or(
          eq(productAccessories.productId, productId),
          eq(productAccessories.accessoryId, productId),
        ),
      );

    await deleteUnits(
      tx,
      unitsToDelete.map((unit) => ({
        unitId: unit.id,
        event: {
          storeId: store.id,
          type: 'deleted',
          actorUserId,
          identifierSnapshot: unit.identifier,
          payload: {
            productId,
            identifier: unit.identifier,
            combinationKey: unit.combinationKey,
          },
        },
      })),
    );

    await tx.delete(products).where(eq(products.id, productId));
  });

  revalidatePath('/dashboard/products');
  return { success: true };
}

export async function duplicateProduct(productId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
    with: {
      pricingTiers: true,
    },
  });

  if (!product) {
    return { error: 'errors.productNotFound' };
  }

  const newProductId = nanoid();
  const effectiveQuantities = await getEffectiveProductQuantities(db, [
    product.id,
  ]);
  const duplicateQuantity = product.trackUnits
    ? effectiveQuantities.get(product.id) ?? 0
    : product.quantity;

  // Note: the "(copy)" suffix will be translated on the client side
  // Note: Unit tracking is NOT duplicated because identifiers are unique per unit.
  // The duplicate starts with trackUnits=false and the original quantity.
  await db.insert(products).values({
    id: newProductId,
    storeId: store.id,
    name: `${product.name} (copy)`,
    description: product.description,
    aiContext: product.aiContext,
    categoryId: product.categoryId,
    price: product.price,
    deposit: product.deposit,
    pricingMode: product.pricingMode,
    basePeriodMinutes: product.basePeriodMinutes,
    quantity: duplicateQuantity,
    status: 'draft',
    images: product.images,
    videoUrl: product.videoUrl,
    taxSettings: product.taxSettings,
    enforceStrictTiers: product.enforceStrictTiers,
    trackUnits: false, // Units cannot be duplicated - they have unique identifiers
    bookingAttributeAxes: null,
  });

  // Duplicate pricing tiers if any
  if (product.pricingTiers && product.pricingTiers.length > 0) {
    await db.insert(productPricingTiers).values(
      product.pricingTiers.map((tier) => ({
        id: nanoid(),
        productId: newProductId,
        minDuration: tier.period && tier.price ? null : tier.minDuration,
        discountPercent:
          tier.period && tier.price ? null : tier.discountPercent,
        period: tier.period,
        price: tier.price,
        displayOrder: tier.displayOrder,
      })),
    );
  }

  revalidatePath('/dashboard/products');
  return { success: true };
}

export async function getProduct(productId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return null;
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
    with: {
      category: true,
      pricingTiers: {
        orderBy: (tiers, { asc }) => [asc(tiers.displayOrder)],
      },
      accessories: {
        orderBy: (acc, { asc }) => [asc(acc.displayOrder)],
        with: {
          accessory: {
            columns: {
              id: true,
              name: true,
              price: true,
              images: true,
              status: true,
            },
          },
        },
      },
      units: {
        orderBy: (units, { asc }) => [asc(units.identifier)],
      },
    },
  });

  return product;
}

// Get all products available as accessories (excluding the current product)
export async function getAvailableAccessories(excludeProductId?: string) {
  const store = await getStoreForUser();
  if (!store) {
    return [];
  }

  const allProducts = await db.query.products.findMany({
    where: and(eq(products.storeId, store.id), eq(products.status, 'active')),
    columns: {
      id: true,
      name: true,
      price: true,
      images: true,
    },
    orderBy: (p, { asc }) => [asc(p.name)],
  });

  // Filter out the current product if provided
  if (excludeProductId) {
    return allProducts.filter((p) => p.id !== excludeProductId);
  }

  return allProducts;
}

// Categories
export async function createCategory(data: CategoryInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = categorySchema.safeParse(data);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  // Get max order
  const existingCategories = await db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
  });
  const maxOrder = Math.max(0, ...existingCategories.map((c) => c.order || 0));

  await db.insert(categories).values({
    storeId: store.id,
    name: validated.data.name,
    description: validated.data.description || null,
    order: maxOrder + 1,
  });

  revalidatePath('/dashboard/products');
  revalidatePath('/dashboard/categories');
  return { success: true };
}

export async function updateCategory(categoryId: string, data: CategoryInput) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const validated = categorySchema.safeParse(data);
  if (!validated.success) {
    return { error: 'errors.invalidData' };
  }

  const category = await db.query.categories.findFirst({
    where: and(eq(categories.id, categoryId), eq(categories.storeId, store.id)),
  });

  if (!category) {
    return { error: 'errors.categoryNotFound' };
  }

  await db
    .update(categories)
    .set({
      name: validated.data.name,
      description: validated.data.description || null,
      updatedAt: new Date(),
    })
    .where(eq(categories.id, categoryId));

  revalidatePath('/dashboard/products');
  revalidatePath('/dashboard/categories');
  return { success: true };
}

export async function deleteCategory(categoryId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const category = await db.query.categories.findFirst({
    where: and(eq(categories.id, categoryId), eq(categories.storeId, store.id)),
  });

  if (!category) {
    return { error: 'errors.categoryNotFound' };
  }

  // Remove category from products
  await db
    .update(products)
    .set({ categoryId: null })
    .where(eq(products.categoryId, categoryId));

  await db.delete(categories).where(eq(categories.id, categoryId));

  revalidatePath('/dashboard/products');
  revalidatePath('/dashboard/categories');
  return { success: true };
}

export async function getCategories() {
  const store = await getStoreForUser();
  if (!store) {
    return [];
  }

  return db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
    orderBy: [categories.order],
  });
}

export async function updateProductsOrder(productIds: string[]) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  // Verify all products belong to this store
  const storeProducts = await db.query.products.findMany({
    where: eq(products.storeId, store.id),
    columns: { id: true },
  });
  const storeProductIds = new Set(storeProducts.map((p) => p.id));

  // Filter to only include valid product IDs
  const validProductIds = productIds.filter((id) => storeProductIds.has(id));

  // Update display order for each product
  await Promise.all(
    validProductIds.map((productId, index) =>
      db
        .update(products)
        .set({
          displayOrder: index,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId)),
    ),
  );

  revalidatePath('/dashboard/products');
  return { success: true };
}
