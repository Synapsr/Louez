'use server'

import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import {
  products,
  productSeasonalPricing,
  productSeasonalPricingTiers,
} from '@louez/db'
import { eq, and, ne, lte, gte, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { priceDurationToMinutes } from '@louez/utils'

// ============================================================================
// Validation schemas
// ============================================================================

const seasonalPricingTierSchema = z.object({
  price: z.string(),
  duration: z.number().min(1),
  unit: z.enum(['minute', 'hour', 'day', 'week']),
})

const seasonalPricingSchema = z.object({
  productId: z.string().length(21),
  name: z.string().min(1).max(100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.string().min(1),
  rateTiers: z.array(seasonalPricingTierSchema).optional(),
})

type SeasonalPricingInput = z.infer<typeof seasonalPricingSchema>

// ============================================================================
// Helpers
// ============================================================================

function normalizePriceInput(value: string | undefined): string {
  return (value || '0').replace(',', '.')
}

async function verifyProductOwnership(productId: string, storeId: string) {
  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, storeId)),
    columns: { id: true },
  })
  return !!product
}

async function checkDateOverlap(
  productId: string,
  startDate: string,
  endDate: string,
  excludeId?: string
): Promise<boolean> {
  const conditions = [
    eq(productSeasonalPricing.productId, productId),
    lte(productSeasonalPricing.startDate, endDate),
    gte(productSeasonalPricing.endDate, startDate),
  ]

  if (excludeId) {
    conditions.push(ne(productSeasonalPricing.id, excludeId))
  }

  const overlapping = await db
    .select({ id: productSeasonalPricing.id })
    .from(productSeasonalPricing)
    .where(and(...conditions))
    .limit(1)

  return overlapping.length > 0
}

// ============================================================================
// Actions
// ============================================================================

export async function getProductSeasonalPricings(productId: string) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' as const }

  const isOwned = await verifyProductOwnership(productId, store.id)
  if (!isOwned) return { error: 'errors.unauthorized' as const }

  const seasonalPricings = await db.query.productSeasonalPricing.findMany({
    where: eq(productSeasonalPricing.productId, productId),
    with: { tiers: true },
    orderBy: (sp, { asc }) => [asc(sp.startDate)],
  })

  return { data: seasonalPricings }
}

export async function createSeasonalPricing(input: SeasonalPricingInput) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' as const }

  const validated = seasonalPricingSchema.safeParse(input)
  if (!validated.success) return { error: 'errors.invalidData' as const }

  const data = validated.data

  // Validate date range
  if (data.startDate >= data.endDate) {
    return { error: 'seasonDateError' as const }
  }

  // Verify ownership
  const isOwned = await verifyProductOwnership(data.productId, store.id)
  if (!isOwned) return { error: 'errors.unauthorized' as const }

  // Check overlap
  const hasOverlap = await checkDateOverlap(data.productId, data.startDate, data.endDate)
  if (hasOverlap) {
    return { error: 'seasonOverlapError' as const }
  }

  const seasonId = nanoid()
  const price = normalizePriceInput(data.price)

  // Insert seasonal pricing
  await db.insert(productSeasonalPricing).values({
    id: seasonId,
    productId: data.productId,
    name: data.name,
    startDate: data.startDate,
    endDate: data.endDate,
    price,
  })

  // Insert tiers if provided
  if (data.rateTiers && data.rateTiers.length > 0) {
    const tierRows = data.rateTiers.map((tier, index) => ({
      id: nanoid(),
      seasonalPricingId: seasonId,
      period: priceDurationToMinutes(tier.duration, tier.unit),
      price: normalizePriceInput(tier.price),
      minDuration: null,
      discountPercent: null,
      displayOrder: index,
    }))

    await db.insert(productSeasonalPricingTiers).values(tierRows)
  }

  revalidatePath(`/dashboard/products/${data.productId}`)
  return { success: true, id: seasonId }
}

export async function updateSeasonalPricing(
  id: string,
  input: Omit<SeasonalPricingInput, 'productId'>
) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' as const }

  // Fetch existing seasonal pricing to get productId
  const existing = await db.query.productSeasonalPricing.findFirst({
    where: eq(productSeasonalPricing.id, id),
    columns: { id: true, productId: true },
  })

  if (!existing) return { error: 'errors.notFound' as const }

  const isOwned = await verifyProductOwnership(existing.productId, store.id)
  if (!isOwned) return { error: 'errors.unauthorized' as const }

  // Validate
  const validated = seasonalPricingSchema.omit({ productId: true }).safeParse(input)
  if (!validated.success) return { error: 'errors.invalidData' as const }

  const data = validated.data

  if (data.startDate >= data.endDate) {
    return { error: 'seasonDateError' as const }
  }

  // Check overlap (exclude self)
  const hasOverlap = await checkDateOverlap(
    existing.productId,
    data.startDate,
    data.endDate,
    id
  )
  if (hasOverlap) {
    return { error: 'seasonOverlapError' as const }
  }

  const price = normalizePriceInput(data.price)

  // Update seasonal pricing
  await db
    .update(productSeasonalPricing)
    .set({
      name: data.name,
      startDate: data.startDate,
      endDate: data.endDate,
      price,
      updatedAt: new Date(),
    })
    .where(eq(productSeasonalPricing.id, id))

  // Replace tiers: delete old, insert new
  await db
    .delete(productSeasonalPricingTiers)
    .where(eq(productSeasonalPricingTiers.seasonalPricingId, id))

  if (data.rateTiers && data.rateTiers.length > 0) {
    const tierRows = data.rateTiers.map((tier, index) => ({
      id: nanoid(),
      seasonalPricingId: id,
      period: priceDurationToMinutes(tier.duration, tier.unit),
      price: normalizePriceInput(tier.price),
      minDuration: null,
      discountPercent: null,
      displayOrder: index,
    }))

    await db.insert(productSeasonalPricingTiers).values(tierRows)
  }

  revalidatePath(`/dashboard/products/${existing.productId}`)
  return { success: true }
}

export async function deleteSeasonalPricing(id: string) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' as const }

  const existing = await db.query.productSeasonalPricing.findFirst({
    where: eq(productSeasonalPricing.id, id),
    columns: { id: true, productId: true },
  })

  if (!existing) return { error: 'errors.notFound' as const }

  const isOwned = await verifyProductOwnership(existing.productId, store.id)
  if (!isOwned) return { error: 'errors.unauthorized' as const }

  // Delete tiers first (no CASCADE in Drizzle), then the seasonal pricing
  await db
    .delete(productSeasonalPricingTiers)
    .where(eq(productSeasonalPricingTiers.seasonalPricingId, id))

  await db
    .delete(productSeasonalPricing)
    .where(eq(productSeasonalPricing.id, id))

  revalidatePath(`/dashboard/products/${existing.productId}`)
  return { success: true }
}

export async function duplicateSeasonalPricing(id: string) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' as const }

  const existing = await db.query.productSeasonalPricing.findFirst({
    where: eq(productSeasonalPricing.id, id),
    with: { tiers: true },
  })

  if (!existing) return { error: 'errors.notFound' as const }

  const isOwned = await verifyProductOwnership(existing.productId, store.id)
  if (!isOwned) return { error: 'errors.unauthorized' as const }

  // Shift dates by +1 year
  const newStartDate = shiftDateByYear(existing.startDate, 1)
  const newEndDate = shiftDateByYear(existing.endDate, 1)

  // Check overlap for the new dates
  const hasOverlap = await checkDateOverlap(
    existing.productId,
    newStartDate,
    newEndDate
  )
  if (hasOverlap) {
    return { error: 'seasonOverlapError' as const }
  }

  const newId = nanoid()

  await db.insert(productSeasonalPricing).values({
    id: newId,
    productId: existing.productId,
    name: `${existing.name} (copie)`,
    startDate: newStartDate,
    endDate: newEndDate,
    price: existing.price,
  })

  if (existing.tiers.length > 0) {
    const tierRows = existing.tiers.map((tier) => ({
      id: nanoid(),
      seasonalPricingId: newId,
      period: tier.period,
      price: tier.price,
      minDuration: tier.minDuration,
      discountPercent: tier.discountPercent,
      displayOrder: tier.displayOrder,
    }))

    await db.insert(productSeasonalPricingTiers).values(tierRows)
  }

  revalidatePath(`/dashboard/products/${existing.productId}`)
  return { success: true, id: newId }
}

// ============================================================================
// Utilities
// ============================================================================

function shiftDateByYear(dateStr: string, years: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setFullYear(d.getFullYear() + years)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
