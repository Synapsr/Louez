import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stores, products, reservations, reservationItems } from '@/lib/db/schema'
import { eq, and, inArray, lt, gt } from 'drizzle-orm'
import { z } from 'zod'
import { dateRangesOverlap, getMinStartDateTime } from '@/lib/utils/duration'
import { validateRentalPeriod } from '@/lib/utils/business-hours'

const querySchema = z.object({
  startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  productIds: z.string().optional(),
})

export interface ProductAvailability {
  productId: string
  totalQuantity: number
  reservedQuantity: number
  availableQuantity: number
  status: 'available' | 'limited' | 'unavailable'
}

export interface BusinessHoursValidation {
  valid: boolean
  errors: string[]
}

export interface AdvanceNoticeValidation {
  valid: boolean
  minimumStartTime?: string
  advanceNoticeHours?: number
}

export interface AvailabilityResponse {
  products: ProductAvailability[]
  period: {
    startDate: string
    endDate: string
  }
  businessHoursValidation?: BusinessHoursValidation
  advanceNoticeValidation?: AdvanceNoticeValidation
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params
    const { searchParams } = new URL(request.url)

    // Validate query parameters
    const parseResult = querySchema.safeParse({
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      productIds: searchParams.get('productIds'),
    })

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { startDate: startDateStr, endDate: endDateStr, productIds: productIdsStr } = parseResult.data

    // Parse dates
    const startDate = new Date(startDateStr)
    const endDate = new Date(endDateStr)

    // Validate date range
    if (endDate <= startDate) {
      return NextResponse.json(
        { error: 'End date must be after start date' },
        { status: 400 }
      )
    }

    // Get the store
    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, slug),
    })

    if (!store) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    // Validate business hours
    const businessHoursValidation = validateRentalPeriod(
      startDate,
      endDate,
      store.settings?.businessHours
    )

    // Validate advance notice
    const advanceNoticeHours = store.settings?.advanceNotice || 0
    const minimumStartTime = getMinStartDateTime(advanceNoticeHours)
    const advanceNoticeValidation: AdvanceNoticeValidation = {
      valid: startDate >= minimumStartTime,
      minimumStartTime: minimumStartTime.toISOString(),
      advanceNoticeHours,
    }

    // Parse product IDs if provided
    const requestedProductIds = productIdsStr ? productIdsStr.split(',').filter(Boolean) : null

    // Get all active products for the store
    const productsQuery = requestedProductIds
      ? and(
          eq(products.storeId, store.id),
          eq(products.status, 'active'),
          inArray(products.id, requestedProductIds)
        )
      : and(eq(products.storeId, store.id), eq(products.status, 'active'))

    const storeProducts = await db.query.products.findMany({
      where: productsQuery,
    })

    if (storeProducts.length === 0) {
      return NextResponse.json({
        products: [],
        period: { startDate: startDateStr, endDate: endDateStr },
        businessHoursValidation,
        advanceNoticeValidation,
      } as AvailabilityResponse)
    }

    // Determine which statuses block availability based on store settings
    // If pendingBlocksAvailability is false (and mode is 'request'), pending reservations don't block
    const pendingBlocksAvailability = store.settings?.pendingBlocksAvailability ?? true
    const blockingStatuses: ('pending' | 'confirmed' | 'ongoing')[] =
      pendingBlocksAvailability
        ? ['pending', 'confirmed', 'ongoing']
        : ['confirmed', 'ongoing']

    // Get overlapping reservations
    // A reservation overlaps if:
    // - It starts before our end date AND
    // - It ends after our start date
    // AND it's in a status that blocks availability
    const overlappingReservations = await db.query.reservations.findMany({
      where: and(
        eq(reservations.storeId, store.id),
        inArray(reservations.status, blockingStatuses),
        lt(reservations.startDate, endDate),
        gt(reservations.endDate, startDate)
      ),
      with: {
        items: true,
      },
    })

    // Calculate reserved quantity per product
    const reservedByProduct = new Map<string, number>()

    for (const reservation of overlappingReservations) {
      // Double-check overlap with our utility function
      if (
        dateRangesOverlap(
          reservation.startDate,
          reservation.endDate,
          startDate,
          endDate
        )
      ) {
        for (const item of reservation.items) {
          // Skip custom items (no productId) - they don't affect catalog availability
          if (!item.productId) continue
          const current = reservedByProduct.get(item.productId) || 0
          reservedByProduct.set(item.productId, current + item.quantity)
        }
      }
    }

    // Calculate availability for each product
    const productAvailability: ProductAvailability[] = storeProducts.map((product) => {
      const reserved = reservedByProduct.get(product.id) || 0
      const available = Math.max(0, product.quantity - reserved)

      let status: ProductAvailability['status']
      if (available === 0) {
        status = 'unavailable'
      } else if (available < product.quantity) {
        status = 'limited'
      } else {
        status = 'available'
      }

      return {
        productId: product.id,
        totalQuantity: product.quantity,
        reservedQuantity: reserved,
        availableQuantity: available,
        status,
      }
    })

    // Set cache headers (30 seconds cache)
    const response = NextResponse.json({
      products: productAvailability,
      period: { startDate: startDateStr, endDate: endDateStr },
      businessHoursValidation,
      advanceNoticeValidation,
    } as AvailabilityResponse)

    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')

    return response
  } catch (error) {
    console.error('Availability API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
