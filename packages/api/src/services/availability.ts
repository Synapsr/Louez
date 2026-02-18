import {
  db,
  productUnits,
  products,
  reservations,
  stores,
} from '@louez/db'
import type {
  AvailabilityResponse,
  BookingAttributeAxis,
  BusinessHours,
  CombinationAvailability,
  ProductAvailability,
  UnitAttributes,
} from '@louez/types'
import {
  DEFAULT_COMBINATION_KEY,
  getDeterministicCombinationSortValue,
} from '@louez/utils'
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

function normalizeTimezone(timezone: unknown): string | undefined {
  if (typeof timezone !== 'string') {
    return undefined
  }

  const normalizedTimezone = timezone.trim()
  if (!normalizedTimezone) {
    return undefined
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalizedTimezone }).format(new Date())
    return normalizedTimezone
  } catch {
    return undefined
  }
}

function getMinStartDateTime(advanceNoticeMinutes: number = 0): Date {
  return new Date(Date.now() + advanceNoticeMinutes * 60 * 1000)
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

function getCombinationMapKey(productId: string, combinationKey: string): string {
  return `${productId}:${combinationKey}`
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

  const timezone = normalizeTimezone(store.settings?.timezone)

  const businessHoursValidation = validateRentalPeriod(
    startDate,
    endDate,
    store.settings?.businessHours,
    timezone,
  )

  const advanceNoticeMinutes = store.settings?.advanceNoticeMinutes || 0
  const minimumStartTime = getMinStartDateTime(advanceNoticeMinutes)
  const advanceNoticeValidation = {
    valid: startDate >= minimumStartTime,
    minimumStartTime: minimumStartTime.toISOString(),
    advanceNoticeMinutes,
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
  const reservedByProductCombination = new Map<string, number>()

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

      const combinationKey = item.combinationKey || DEFAULT_COMBINATION_KEY
      const combinationMapKey = getCombinationMapKey(item.productId, combinationKey)
      const currentCombinationQty = reservedByProductCombination.get(combinationMapKey) || 0
      reservedByProductCombination.set(combinationMapKey, currentCombinationQty + item.quantity)
    }
  }

  const trackedProductIds = storeProducts.filter((product) => product.trackUnits).map((product) => product.id)
  const availableUnits = trackedProductIds.length > 0
    ? await db
        .select({
          productId: productUnits.productId,
          combinationKey: productUnits.combinationKey,
          attributes: productUnits.attributes,
        })
        .from(productUnits)
        .where(
          and(
            inArray(productUnits.productId, trackedProductIds),
            eq(productUnits.status, 'available'),
          ),
        )
    : []

  const combinationsByProduct = new Map<string, Map<string, { totalQuantity: number; selectedAttributes: UnitAttributes }>>()

  for (const unit of availableUnits) {
    const productMap = combinationsByProduct.get(unit.productId) || new Map()
    const combinationKey = unit.combinationKey || DEFAULT_COMBINATION_KEY
    const current = productMap.get(combinationKey)

    if (!current) {
      productMap.set(combinationKey, {
        totalQuantity: 1,
        selectedAttributes: (unit.attributes || {}) as UnitAttributes,
      })
    } else {
      current.totalQuantity += 1
      if (Object.keys(current.selectedAttributes).length === 0 && unit.attributes) {
        current.selectedAttributes = unit.attributes as UnitAttributes
      }
      productMap.set(combinationKey, current)
    }

    combinationsByProduct.set(unit.productId, productMap)
  }

  const productAvailability: ProductAvailability[] = storeProducts.map((product) => {
    if (!product.trackUnits) {
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
    }

    const productCombinations = combinationsByProduct.get(product.id) || new Map()
    const axes = Array.isArray(product.bookingAttributeAxes)
      ? (product.bookingAttributeAxes as BookingAttributeAxis[])
      : []
    const combinations: CombinationAvailability[] = []

    let totalQuantity = 0
    for (const [combinationKey, combinationData] of productCombinations.entries()) {
      const reservedQuantity = reservedByProductCombination.get(
        getCombinationMapKey(product.id, combinationKey),
      ) || 0
      const availableQuantity = Math.max(0, combinationData.totalQuantity - reservedQuantity)

      totalQuantity += combinationData.totalQuantity

      let status: CombinationAvailability['status'] = 'available'
      if (availableQuantity === 0) {
        status = 'unavailable'
      } else if (availableQuantity < combinationData.totalQuantity) {
        status = 'limited'
      }

      combinations.push({
        combinationKey,
        selectedAttributes: combinationData.selectedAttributes || {},
        totalQuantity: combinationData.totalQuantity,
        reservedQuantity,
        availableQuantity,
        status,
      })
    }

    combinations.sort((a, b) => {
      const sortA = getDeterministicCombinationSortValue(axes, a.selectedAttributes)
      const sortB = getDeterministicCombinationSortValue(axes, b.selectedAttributes)
      return sortA.localeCompare(sortB, 'en')
    })

    const reservedQuantity = reservedByProduct.get(product.id) || 0
    const availableQuantity = Math.max(0, totalQuantity - reservedQuantity)

    let status: ProductAvailability['status'] = 'available'
    if (availableQuantity === 0) {
      status = 'unavailable'
    } else if (availableQuantity < totalQuantity) {
      status = 'limited'
    }

    return {
      productId: product.id,
      totalQuantity,
      reservedQuantity,
      availableQuantity,
      status,
      combinations,
    }
  })

  return {
    products: productAvailability,
    period: { startDate: startDateStr, endDate: endDateStr },
    businessHoursValidation,
    advanceNoticeValidation,
  }
}
