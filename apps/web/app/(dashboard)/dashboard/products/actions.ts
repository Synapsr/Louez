'use server'

import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import {
  products,
  categories,
  productPricingTiers,
  productAccessories,
  productUnits,
  reservations,
  reservationItems,
} from '@louez/db'
import { eq, and, ne, inArray, or, gte, not } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  productSchema,
  categorySchema,
  type ProductInput,
  type CategoryInput,
  type ProductUnitInput,
} from '@louez/validations'
import { nanoid } from 'nanoid'
import {
  buildCombinationKey,
  canonicalizeAttributes,
  DEFAULT_COMBINATION_KEY,
  normalizeAxisKey,
  priceDurationToMinutes,
  pricingModeToMinutes,
  validatePricingTiers,
} from '@louez/utils'
import type { BookingAttributeAxis, UnitAttributes } from '@louez/types'
import { notifyProductCreated, notifyProductUpdated } from '@/lib/discord/platform-notifications'

async function getStoreForUser() {
  return getCurrentStore()
}

function normalizeBookingAttributeAxes(axes: ProductInput['bookingAttributeAxes']): BookingAttributeAxis[] {
  if (!axes || axes.length === 0) {
    return []
  }

  return axes
    .map((axis, index) => ({
      key: normalizeAxisKey(axis.key),
      label: axis.label.trim(),
      position: index,
    }))
    .filter((axis) => axis.key.length > 0 && axis.label.length > 0)
}

function resolveUnitAttributes(
  axes: BookingAttributeAxis[],
  unit: ProductUnitInput,
): UnitAttributes {
  return canonicalizeAttributes(axes, unit.attributes as UnitAttributes | undefined)
}

function normalizePriceInput(value: string | undefined): string {
  return (value || '0').replace(',', '.')
}

function getLegacyPricingModeFromUnit(unit: 'minute' | 'hour' | 'day' | 'week'): 'hour' | 'day' | 'week' {
  if (unit === 'week') return 'week'
  if (unit === 'day') return 'day'
  return 'hour'
}

function buildRateTierRows(
  input: ProductInput,
  basePrice: number,
  basePeriodMinutes: number,
): Array<{
  id?: string
  period: number
  price: string
  minDuration: number | null
  discountPercent: string | null
}> {
  if (input.rateTiers && input.rateTiers.length > 0) {
    const rows = input.rateTiers.map((tier) => {
      const period = priceDurationToMinutes(tier.duration, tier.unit)
      const tierPrice = normalizePriceInput(tier.price)

      return {
        id: tier.id,
        period,
        price: tierPrice,
        // Legacy compatibility columns are intentionally not persisted.
        minDuration: null,
        discountPercent: null,
      }
    })

    return rows.sort((a, b) => a.period - b.period)
  }

  // Backward fallback for legacy payloads.
  const legacyTiers = input.pricingTiers || []
  const rows = legacyTiers.map((tier) => {
    const period = tier.minDuration * basePeriodMinutes
    const unitPrice = basePrice * (1 - tier.discountPercent / 100)
    const totalPrice = unitPrice * tier.minDuration
    return {
      id: tier.id,
      period,
      price: totalPrice.toFixed(2),
      minDuration: null,
      discountPercent: null,
    }
  })

  return rows.sort((a, b) => a.period - b.period)
}

export async function createProduct(data: ProductInput) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = productSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Validate legacy pricing tiers if provided (fallback compatibility only)
  const pricingTiers = validated.data.pricingTiers || []
  if (!validated.data.rateTiers?.length && pricingTiers.length > 0) {
    const tierValidation = validatePricingTiers(pricingTiers)
    if (!tierValidation.valid) {
      return { error: tierValidation.error }
    }
  }

  const basePriceDuration = validated.data.basePriceDuration
  const price = normalizePriceInput(basePriceDuration?.price || validated.data.price)
  const basePeriodMinutes = basePriceDuration
    ? priceDurationToMinutes(basePriceDuration.duration, basePriceDuration.unit)
    : pricingModeToMinutes((validated.data.pricingMode || 'day') as 'hour' | 'day' | 'week')
  const legacyPricingMode = basePriceDuration
    ? getLegacyPricingModeFromUnit(basePriceDuration.unit)
    : ((validated.data.pricingMode || 'day') as 'hour' | 'day' | 'week')
  const deposit = validated.data.deposit
    ? normalizePriceInput(validated.data.deposit)
    : '0'
  const rateTierRows = buildRateTierRows(
    validated.data,
    parseFloat(price) || 0,
    basePeriodMinutes,
  )

  // Unit tracking
  const trackUnits = validated.data.trackUnits || false
  const units = validated.data.units || []
  const bookingAttributeAxes = trackUnits
    ? normalizeBookingAttributeAxes(validated.data.bookingAttributeAxes)
    : []

  // If tracking units, quantity is derived from the count of available units
  // Otherwise, use the manually entered quantity
  const quantity = trackUnits
    ? units.filter((u) => !u.status || u.status === 'available').length
    : parseInt(validated.data.quantity, 10)

  const productId = nanoid()

  await db.insert(products).values({
    id: productId,
    storeId: store.id,
    name: validated.data.name,
    description: validated.data.description || null,
    categoryId: validated.data.categoryId || null,
    price: price,
    deposit: deposit,
    pricingMode: legacyPricingMode,
    basePeriodMinutes,
    quantity: quantity,
    status: validated.data.status,
    images: validated.data.images || [],
    videoUrl: validated.data.videoUrl || null,
    taxSettings: validated.data.taxSettings || null,
    enforceStrictTiers: validated.data.enforceStrictTiers || false,
    trackUnits: trackUnits,
    bookingAttributeAxes: trackUnits && bookingAttributeAxes.length > 0
      ? bookingAttributeAxes
      : null,
  })

  // Create pricing tiers if provided
  if (rateTierRows.length > 0) {
    await db.insert(productPricingTiers).values(
      rateTierRows.map((tier, index) => ({
        id: nanoid(),
        productId: productId,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent,
        period: tier.period,
        price: tier.price,
        displayOrder: index,
      }))
    )
  }

  // Create units if tracking is enabled
  if (trackUnits && units.length > 0) {
    await db.insert(productUnits).values(
      units.map((unit) => ({
        attributes: resolveUnitAttributes(bookingAttributeAxes, unit),
        combinationKey: buildCombinationKey(
          bookingAttributeAxes,
          resolveUnitAttributes(bookingAttributeAxes, unit),
        ),
        id: nanoid(),
        productId: productId,
        identifier: unit.identifier.trim(),
        notes: unit.notes?.trim() || null,
        status: unit.status || 'available',
      }))
    )
  }

  notifyProductCreated(
    { id: store.id, name: store.name, slug: store.slug },
    validated.data.name
  ).catch(() => {})

  revalidatePath('/dashboard/products')
  return { success: true, productId }
}

export async function updateProduct(productId: string, data: ProductInput) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = productSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Validate legacy pricing tiers only when V2 rates are not provided.
  const pricingTiers = validated.data.pricingTiers || []
  if (!validated.data.rateTiers?.length && pricingTiers.length > 0) {
    const tierValidation = validatePricingTiers(pricingTiers)
    if (!tierValidation.valid) {
      return { error: tierValidation.error }
    }
  }

  // Verify product belongs to store
  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
  })

  if (!product) {
    return { error: 'errors.productNotFound' }
  }

  const basePriceDuration = validated.data.basePriceDuration
  const price = normalizePriceInput(basePriceDuration?.price || validated.data.price)
  const basePeriodMinutes = basePriceDuration
    ? priceDurationToMinutes(basePriceDuration.duration, basePriceDuration.unit)
    : pricingModeToMinutes((validated.data.pricingMode || product.pricingMode || 'day') as 'hour' | 'day' | 'week')
  const legacyPricingMode = basePriceDuration
    ? getLegacyPricingModeFromUnit(basePriceDuration.unit)
    : ((validated.data.pricingMode || product.pricingMode || 'day') as 'hour' | 'day' | 'week')
  const deposit = validated.data.deposit
    ? normalizePriceInput(validated.data.deposit)
    : '0'
  const rateTierRows = buildRateTierRows(
    validated.data,
    parseFloat(price) || 0,
    basePeriodMinutes,
  )

  // Unit tracking
  const trackUnits = validated.data.trackUnits || false
  const units = validated.data.units || []
  const bookingAttributeAxes = trackUnits
    ? normalizeBookingAttributeAxes(validated.data.bookingAttributeAxes)
    : []

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
          inArray(reservations.status, ['pending', 'confirmed', 'ongoing']),
          gte(reservations.endDate, new Date()),
        ),
      )
      .limit(1)

    if (conflictingVariantReservations.length > 0) {
      return { error: 'errors.cannotDisableUnitTrackingWithCombinations' }
    }
  }

  // Prevent edits that would make available unit capacity lower than
  // active/future reserved quantities for any combination.
  if (trackUnits) {
    const proposedAvailableByCombination = new Map<string, number>()

    for (const unit of units) {
      const status = unit.status || 'available'
      if (status !== 'available') {
        continue
      }

      const attributes = resolveUnitAttributes(bookingAttributeAxes, unit)
      const combinationKey = buildCombinationKey(bookingAttributeAxes, attributes)
      proposedAvailableByCombination.set(
        combinationKey,
        (proposedAvailableByCombination.get(combinationKey) || 0) + 1,
      )
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
          inArray(reservations.status, ['pending', 'confirmed', 'ongoing']),
          gte(reservations.endDate, new Date()),
        ),
      )

    const reservedByCombination = new Map<string, number>()
    for (const row of reservedRows) {
      const combinationKey = row.combinationKey || DEFAULT_COMBINATION_KEY
      reservedByCombination.set(
        combinationKey,
        (reservedByCombination.get(combinationKey) || 0) + row.quantity,
      )
    }

    const hasCapacityConflict = [...reservedByCombination.entries()].some(
      ([combinationKey, reservedQty]) => {
        const availableQty = proposedAvailableByCombination.get(combinationKey) || 0
        return reservedQty > availableQty
      },
    )

    if (hasCapacityConflict) {
      return { error: 'errors.unitStatusConflictsWithReservations' }
    }
  }

  // If tracking units, quantity is derived from the count of available units
  // Otherwise, use the manually entered quantity
  const quantity = trackUnits
    ? units.filter((u) => !u.status || u.status === 'available').length
    : parseInt(validated.data.quantity, 10)

  await db
    .update(products)
    .set({
      name: validated.data.name,
      description: validated.data.description || null,
      categoryId: validated.data.categoryId || null,
      price: price,
      deposit: deposit,
      pricingMode: legacyPricingMode,
      basePeriodMinutes,
      quantity: quantity,
      status: validated.data.status,
      images: validated.data.images || [],
      videoUrl: validated.data.videoUrl || null,
      taxSettings: validated.data.taxSettings || null,
      enforceStrictTiers: validated.data.enforceStrictTiers || false,
      trackUnits: trackUnits,
      bookingAttributeAxes: trackUnits && bookingAttributeAxes.length > 0
        ? bookingAttributeAxes
        : null,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))

  // Update pricing tiers: delete all existing and insert new ones
  await db.delete(productPricingTiers).where(eq(productPricingTiers.productId, productId))

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
      }))
    )
  }

  // Update product units: sync with provided units
  if (trackUnits) {
    // Get existing units
    const existingUnits = await db.query.productUnits.findMany({
      where: eq(productUnits.productId, productId),
    })
    const existingUnitIds = new Set(existingUnits.map((u) => u.id))

    // Separate units into updates and inserts
    const unitsToUpdate = units.filter((u) => u.id && existingUnitIds.has(u.id))
    const unitsToInsert = units.filter((u) => !u.id)
    const unitIdsToKeep = new Set(units.filter((u) => u.id).map((u) => u.id))

    // Delete units that are no longer in the list
    // Note: We don't delete units that are assigned to active reservations
    // (this is handled in the UI by disabling the delete button)
    const unitIdsToDelete = existingUnits
      .filter((u) => !unitIdsToKeep.has(u.id))
      .map((u) => u.id)

    if (unitIdsToDelete.length > 0) {
      await db.delete(productUnits).where(inArray(productUnits.id, unitIdsToDelete))
    }

    // Update existing units
    for (const unit of unitsToUpdate) {
      if (unit.id) {
        const attributes = resolveUnitAttributes(bookingAttributeAxes, unit)
        await db
          .update(productUnits)
          .set({
            identifier: unit.identifier.trim(),
            notes: unit.notes?.trim() || null,
            status: unit.status || 'available',
            attributes,
            combinationKey: buildCombinationKey(bookingAttributeAxes, attributes),
            updatedAt: new Date(),
          })
          .where(eq(productUnits.id, unit.id))
      }
    }

    // Insert new units
    if (unitsToInsert.length > 0) {
      await db.insert(productUnits).values(
        unitsToInsert.map((unit) => {
          const attributes = resolveUnitAttributes(bookingAttributeAxes, unit)
          return {
            id: nanoid(),
            productId: productId,
            identifier: unit.identifier.trim(),
            notes: unit.notes?.trim() || null,
            status: unit.status || 'available',
            attributes,
            combinationKey: buildCombinationKey(bookingAttributeAxes, attributes),
          }
        })
      )
    }
  }

  // Update accessories: delete all existing and insert new ones
  const accessoryIds = validated.data.accessoryIds || []
  await db.delete(productAccessories).where(eq(productAccessories.productId, productId))

  if (accessoryIds.length > 0) {
    // Verify all accessories belong to the same store and are not the product itself
    const validAccessories = await db.query.products.findMany({
      where: and(
        eq(products.storeId, store.id),
        inArray(products.id, accessoryIds),
        ne(products.id, productId)
      ),
      columns: { id: true },
    })

    const validAccessoryIds = validAccessories.map((a) => a.id)

    if (validAccessoryIds.length > 0) {
      await db.insert(productAccessories).values(
        validAccessoryIds.map((accessoryId, index) => ({
          id: nanoid(),
          productId: productId,
          accessoryId: accessoryId,
          displayOrder: index,
        }))
      )
    }
  }

  notifyProductUpdated(
    { id: store.id, name: store.name, slug: store.slug },
    validated.data.name
  ).catch(() => {})

  revalidatePath('/dashboard/products')
  revalidatePath(`/dashboard/products/${productId}`)
  return { success: true }
}

export async function updateProductStatus(
  productId: string,
  status: 'draft' | 'active' | 'archived'
) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
  })

  if (!product) {
    return { error: 'errors.productNotFound' }
  }

  await db
    .update(products)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))

  revalidatePath('/dashboard/products')
  return { success: true }
}

export async function deleteProduct(productId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
  })

  if (!product) {
    return { error: 'errors.productNotFound' }
  }

  // Delete accessory relations (both as product and as accessory)
  await db.delete(productAccessories).where(
    or(
      eq(productAccessories.productId, productId),
      eq(productAccessories.accessoryId, productId)
    )
  )

  // Delete product units
  await db.delete(productUnits).where(eq(productUnits.productId, productId))

  await db.delete(products).where(eq(products.id, productId))

  revalidatePath('/dashboard/products')
  return { success: true }
}

export async function duplicateProduct(productId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
    with: {
      pricingTiers: true,
    },
  })

  if (!product) {
    return { error: 'errors.productNotFound' }
  }

  const newProductId = nanoid()

  // Note: the "(copy)" suffix will be translated on the client side
  // Note: Unit tracking is NOT duplicated because identifiers are unique per unit.
  // The duplicate starts with trackUnits=false and the original quantity.
  await db.insert(products).values({
    id: newProductId,
    storeId: store.id,
    name: `${product.name} (copy)`,
    description: product.description,
    categoryId: product.categoryId,
    price: product.price,
    deposit: product.deposit,
    pricingMode: product.pricingMode,
    basePeriodMinutes: product.basePeriodMinutes,
    quantity: product.quantity,
    status: 'draft',
    images: product.images,
    videoUrl: product.videoUrl,
    taxSettings: product.taxSettings,
    enforceStrictTiers: product.enforceStrictTiers,
    trackUnits: false, // Units cannot be duplicated - they have unique identifiers
    bookingAttributeAxes: null,
  })

  // Duplicate pricing tiers if any
  if (product.pricingTiers && product.pricingTiers.length > 0) {
    await db.insert(productPricingTiers).values(
      product.pricingTiers.map((tier) => ({
        id: nanoid(),
        productId: newProductId,
        minDuration: tier.period && tier.price ? null : tier.minDuration,
        discountPercent: tier.period && tier.price ? null : tier.discountPercent,
        period: tier.period,
        price: tier.price,
        displayOrder: tier.displayOrder,
      }))
    )
  }

  revalidatePath('/dashboard/products')
  return { success: true }
}

export async function getProduct(productId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return null
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
  })

  return product
}

// Get all products available as accessories (excluding the current product)
export async function getAvailableAccessories(excludeProductId?: string) {
  const store = await getStoreForUser()
  if (!store) {
    return []
  }

  const allProducts = await db.query.products.findMany({
    where: and(
      eq(products.storeId, store.id),
      eq(products.status, 'active')
    ),
    columns: {
      id: true,
      name: true,
      price: true,
      images: true,
    },
    orderBy: (p, { asc }) => [asc(p.name)],
  })

  // Filter out the current product if provided
  if (excludeProductId) {
    return allProducts.filter((p) => p.id !== excludeProductId)
  }

  return allProducts
}

// Categories
export async function createCategory(data: CategoryInput) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = categorySchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Get max order
  const existingCategories = await db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
  })
  const maxOrder = Math.max(0, ...existingCategories.map((c) => c.order || 0))

  await db.insert(categories).values({
    storeId: store.id,
    name: validated.data.name,
    description: validated.data.description || null,
    order: maxOrder + 1,
  })

  revalidatePath('/dashboard/products')
  revalidatePath('/dashboard/categories')
  return { success: true }
}

export async function updateCategory(categoryId: string, data: CategoryInput) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = categorySchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  const category = await db.query.categories.findFirst({
    where: and(eq(categories.id, categoryId), eq(categories.storeId, store.id)),
  })

  if (!category) {
    return { error: 'errors.categoryNotFound' }
  }

  await db
    .update(categories)
    .set({
      name: validated.data.name,
      description: validated.data.description || null,
      updatedAt: new Date(),
    })
    .where(eq(categories.id, categoryId))

  revalidatePath('/dashboard/products')
  revalidatePath('/dashboard/categories')
  return { success: true }
}

export async function deleteCategory(categoryId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const category = await db.query.categories.findFirst({
    where: and(eq(categories.id, categoryId), eq(categories.storeId, store.id)),
  })

  if (!category) {
    return { error: 'errors.categoryNotFound' }
  }

  // Remove category from products
  await db
    .update(products)
    .set({ categoryId: null })
    .where(eq(products.categoryId, categoryId))

  await db.delete(categories).where(eq(categories.id, categoryId))

  revalidatePath('/dashboard/products')
  revalidatePath('/dashboard/categories')
  return { success: true }
}

export async function getCategories() {
  const store = await getStoreForUser()
  if (!store) {
    return []
  }

  return db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
    orderBy: [categories.order],
  })
}

export async function updateProductsOrder(productIds: string[]) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Verify all products belong to this store
  const storeProducts = await db.query.products.findMany({
    where: eq(products.storeId, store.id),
    columns: { id: true },
  })
  const storeProductIds = new Set(storeProducts.map((p) => p.id))

  // Filter to only include valid product IDs
  const validProductIds = productIds.filter((id) => storeProductIds.has(id))

  // Update display order for each product
  await Promise.all(
    validProductIds.map((productId, index) =>
      db
        .update(products)
        .set({
          displayOrder: index,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
    )
  )

  revalidatePath('/dashboard/products')
  return { success: true }
}
