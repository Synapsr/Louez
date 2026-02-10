import { db, products, reservations, stores } from '@louez/db'
import type { BusinessHours, AvailabilityResponse, ProductAvailability } from '@louez/types'
import { and, eq, gt, inArray, lt } from 'drizzle-orm'
import { ApiServiceError } from './errors'

const WEEKDAY_INDEX: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function getMinStartDateTime(advanceNoticeHours: number = 0): Date {
  return new Date(Date.now() + advanceNoticeHours * 60 * 60 * 1000)
}

function dateRangesOverlap(
  range1Start: Date,
  range1End: Date,
  range2Start: Date,
  range2End: Date,
): boolean {
  return range1Start < range2End && range2Start < range1End
}

function getDateKeyInTimezone(date: Date, timezone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function getWeekdayAndTimeInTimezone(
  date: Date,
  timezone?: string,
): { weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const weekdayLabel = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'

  return {
    weekday: WEEKDAY_INDEX[weekdayLabel] ?? 0,
    time: `${hour}:${minute}`,
  }
}

function getClosureReason(
  date: Date,
  businessHours: BusinessHours,
  timezone?: string,
): 'closure_period' | null {
  if (!businessHours.closurePeriods?.length) {
    return null
  }

  const dayKey = getDateKeyInTimezone(date, timezone)

  for (const period of businessHours.closurePeriods) {
    if (!period.startDate || !period.endDate) {
      continue
    }

    if (dayKey >= period.startDate && dayKey <= period.endDate) {
      return 'closure_period'
    }
  }

  return null
}

function validateDateTimeInBusinessHours(
  date: Date,
  businessHours: BusinessHours | undefined,
  timezone?: string,
): { valid: boolean; reason?: 'closure_period' | 'day_closed' | 'outside_hours' } {
  if (!businessHours?.enabled) {
    return { valid: true }
  }

  const closureReason = getClosureReason(date, businessHours, timezone)
  if (closureReason) {
    return { valid: false, reason: closureReason }
  }

  const { weekday, time } = getWeekdayAndTimeInTimezone(date, timezone)
  const schedule = businessHours.schedule[weekday]

  if (!schedule?.isOpen) {
    return { valid: false, reason: 'day_closed' }
  }

  if (time < schedule.openTime || time > schedule.closeTime) {
    return { valid: false, reason: 'outside_hours' }
  }

  return { valid: true }
}

function validateRentalPeriod(
  startDate: Date,
  endDate: Date,
  businessHours: BusinessHours | undefined,
  timezone?: string,
) {
  if (!businessHours?.enabled) {
    return { valid: true, errors: [] as string[] }
  }

  const errors: string[] = []

  const pickup = validateDateTimeInBusinessHours(startDate, businessHours, timezone)
  if (!pickup.valid && pickup.reason) {
    errors.push(`pickup_${pickup.reason}`)
  }

  const dropoff = validateDateTimeInBusinessHours(endDate, businessHours, timezone)
  if (!dropoff.valid && dropoff.reason) {
    errors.push(`return_${dropoff.reason}`)
  }

  return { valid: errors.length === 0, errors }
}

interface GetStorefrontAvailabilityParams {
  storeSlug: string
  startDate: string
  endDate: string
  productIds?: string[]
}

export async function getStorefrontAvailability(
  params: GetStorefrontAvailabilityParams,
): Promise<AvailabilityResponse> {
  const { storeSlug, startDate: startDateStr, endDate: endDateStr, productIds } = params

  const startDate = new Date(startDateStr)
  const endDate = new Date(endDateStr)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.invalidData')
  }

  if (endDate <= startDate) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.invalidData')
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
  })

  if (!store) {
    throw new ApiServiceError('NOT_FOUND', 'errors.storeNotFound')
  }

  const businessHoursValidation = validateRentalPeriod(
    startDate,
    endDate,
    store.settings?.businessHours,
    store.settings?.timezone,
  )

  const advanceNoticeHours = store.settings?.advanceNotice || 0
  const minimumStartTime = getMinStartDateTime(advanceNoticeHours)
  const advanceNoticeValidation = {
    valid: startDate >= minimumStartTime,
    minimumStartTime: minimumStartTime.toISOString(),
    advanceNoticeHours,
  }

  const productsWhere = productIds?.length
    ? and(
        eq(products.storeId, store.id),
        eq(products.status, 'active'),
        inArray(products.id, productIds),
      )
    : and(eq(products.storeId, store.id), eq(products.status, 'active'))

  const storeProducts = await db.query.products.findMany({
    where: productsWhere,
  })

  if (storeProducts.length === 0) {
    return {
      products: [],
      period: { startDate: startDateStr, endDate: endDateStr },
      businessHoursValidation,
      advanceNoticeValidation,
    }
  }

  const pendingBlocksAvailability = store.settings?.pendingBlocksAvailability ?? true
  const blockingStatuses: ('pending' | 'confirmed' | 'ongoing')[] =
    pendingBlocksAvailability
      ? ['pending', 'confirmed', 'ongoing']
      : ['confirmed', 'ongoing']

  const overlappingReservations = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, store.id),
      inArray(reservations.status, blockingStatuses),
      lt(reservations.startDate, endDate),
      gt(reservations.endDate, startDate),
    ),
    with: {
      items: true,
    },
  })

  const reservedByProduct = new Map<string, number>()

  for (const reservation of overlappingReservations) {
    if (!dateRangesOverlap(reservation.startDate, reservation.endDate, startDate, endDate)) {
      continue
    }

    for (const item of reservation.items) {
      if (!item.productId) {
        continue
      }

      const current = reservedByProduct.get(item.productId) || 0
      reservedByProduct.set(item.productId, current + item.quantity)
    }
  }

  const productAvailability: ProductAvailability[] = storeProducts.map((product) => {
    const reservedQuantity = reservedByProduct.get(product.id) || 0
    const availableQuantity = Math.max(0, product.quantity - reservedQuantity)

    let status: ProductAvailability['status'] = 'available'
    if (availableQuantity === 0) {
      status = 'unavailable'
    } else if (availableQuantity < product.quantity) {
      status = 'limited'
    }

    return {
      productId: product.id,
      totalQuantity: product.quantity,
      reservedQuantity,
      availableQuantity,
      status,
    }
  })

  return {
    products: productAvailability,
    period: { startDate: startDateStr, endDate: endDateStr },
    businessHoursValidation,
    advanceNoticeValidation,
  }
}
