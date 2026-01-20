/**
 * Calendar utility functions
 *
 * This module provides pure functions for date calculations and
 * reservation positioning in calendar views.
 */

import type {
  Reservation,
  PositionedReservation,
  SpanningReservation,
  WeekLayout,
  TimelineConfig,
  TimelineProductRow,
  Product,
} from './types'

// =============================================================================
// Date Utilities
// =============================================================================

/**
 * Returns the start of day (midnight) for a given date
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

/**
 * Returns the end of day (23:59:59.999) for a given date
 */
export function endOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(23, 59, 59, 999)
  return result
}

/**
 * Returns Monday of the week containing the given date
 */
export function getWeekStart(date: Date): Date {
  const result = new Date(date)
  const day = result.getDay()
  const diff = day === 0 ? -6 : 1 - day
  result.setDate(result.getDate() + diff)
  return startOfDay(result)
}

/**
 * Returns Sunday of the week containing the given date
 */
export function getWeekEnd(date: Date): Date {
  const weekStart = getWeekStart(date)
  const result = new Date(weekStart)
  result.setDate(weekStart.getDate() + 6)
  return endOfDay(result)
}

/**
 * Checks if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

/**
 * Returns the number of days between two dates
 */
export function daysBetween(startDate: Date, endDate: Date): number {
  const start = startOfDay(startDate)
  const end = startOfDay(endDate)
  const diffMs = end.getTime() - start.getTime()
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Generates an array of dates for a given range
 */
export function generateDateRange(startDate: Date, daysCount: number): Date[] {
  const dates: Date[] = []
  const start = startOfDay(startDate)

  for (let i = 0; i < daysCount; i++) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    dates.push(date)
  }

  return dates
}

/**
 * Gets the week days (Monday to Sunday) for a given date
 */
export function getWeekDays(date: Date): Date[] {
  const weekStart = getWeekStart(date)
  return generateDateRange(weekStart, 7)
}

// =============================================================================
// Reservation Filtering
// =============================================================================

/**
 * Checks if a reservation overlaps with a date range
 */
export function reservationOverlapsRange(
  reservation: Reservation,
  rangeStart: Date,
  rangeEnd: Date
): boolean {
  const resStart = startOfDay(new Date(reservation.startDate))
  const resEnd = endOfDay(new Date(reservation.endDate))
  const start = startOfDay(rangeStart)
  const end = endOfDay(rangeEnd)

  return resStart <= end && resEnd >= start
}

/**
 * Checks if a reservation includes a specific day
 */
export function reservationIncludesDay(
  reservation: Reservation,
  day: Date
): boolean {
  const resStart = startOfDay(new Date(reservation.startDate))
  const resEnd = endOfDay(new Date(reservation.endDate))
  const dayStart = startOfDay(day)
  const dayEnd = endOfDay(day)

  return resStart <= dayEnd && resEnd >= dayStart
}

/**
 * Filters reservations that overlap with a date range
 */
export function filterReservationsInRange(
  reservations: Reservation[],
  rangeStart: Date,
  rangeEnd: Date
): Reservation[] {
  return reservations.filter((r) =>
    reservationOverlapsRange(r, rangeStart, rangeEnd)
  )
}

/**
 * Filters reservations for a specific product
 */
export function filterReservationsByProduct(
  reservations: Reservation[],
  productId: string
): Reservation[] {
  return reservations.filter((r) =>
    r.items.some((item) => item.product?.id === productId)
  )
}

// =============================================================================
// Timeline Positioning
// =============================================================================

/**
 * Calculates the position and width of a reservation bar in the timeline
 */
export function calculateTimelinePosition(
  reservation: Reservation,
  config: TimelineConfig
): PositionedReservation {
  const { startDate: rangeStart, endDate: rangeEnd, daysCount } = config

  const resStart = startOfDay(new Date(reservation.startDate))
  const resEnd = endOfDay(new Date(reservation.endDate))
  const configStart = startOfDay(rangeStart)
  const configEnd = endOfDay(rangeEnd)

  // Calculate start position
  const startDiff = daysBetween(configStart, resStart)
  const startPercent = Math.max(0, (startDiff / daysCount) * 100)

  // Calculate end position
  const endDiff = daysBetween(configStart, resEnd)
  const endPercent = Math.min(100, ((endDiff + 1) / daysCount) * 100)

  // Calculate width
  const widthPercent = endPercent - startPercent

  // Check continuation
  const continuesBefore = resStart < configStart
  const continuesAfter = resEnd > configEnd

  return {
    reservation,
    startPercent: Math.max(0, startPercent),
    widthPercent: Math.max(0, widthPercent),
    row: 0, // Will be set by the stacking algorithm
    continuesBefore,
    continuesAfter,
  }
}

/**
 * Assigns row indices to avoid visual overlap of reservations
 *
 * Uses a greedy algorithm:
 * 1. Sort reservations by start date
 * 2. For each reservation, find the first available row
 * 3. A row is available if it doesn't conflict with the reservation's time range
 */
export function assignRowsToReservations(
  positionedReservations: PositionedReservation[]
): PositionedReservation[] {
  if (positionedReservations.length === 0) return []

  // Sort by start position (earlier first), then by width (longer first for stability)
  const sorted = [...positionedReservations].sort((a, b) => {
    if (a.startPercent !== b.startPercent) {
      return a.startPercent - b.startPercent
    }
    return b.widthPercent - a.widthPercent
  })

  // Track end positions for each row
  const rowEndPositions: number[] = []

  return sorted.map((positioned) => {
    const { startPercent, widthPercent } = positioned
    const endPercent = startPercent + widthPercent

    // Find the first row where this reservation fits
    let row = 0
    while (
      row < rowEndPositions.length &&
      rowEndPositions[row] > startPercent
    ) {
      row++
    }

    // Update the row's end position
    rowEndPositions[row] = endPercent

    return { ...positioned, row }
  })
}

// =============================================================================
// Week View Spanning Reservations
// =============================================================================

/**
 * Calculates spanning reservation layout for the week view
 */
export function calculateWeekLayout(
  reservations: Reservation[],
  weekStart: Date
): WeekLayout {
  const weekEnd = getWeekEnd(weekStart)
  const weekDays = getWeekDays(weekStart)

  // Filter reservations that overlap with this week
  const weekReservations = filterReservationsInRange(
    reservations,
    weekStart,
    weekEnd
  )

  // Calculate spanning info for each reservation
  const spanningReservations: SpanningReservation[] = weekReservations.map(
    (reservation) => {
      const resStart = startOfDay(new Date(reservation.startDate))
      const resEnd = endOfDay(new Date(reservation.endDate))

      // Find start day index (0-6 or -1 if before the week)
      let startDayIndex = -1
      for (let i = 0; i < 7; i++) {
        if (isSameDay(weekDays[i], resStart) || resStart < weekDays[i]) {
          startDayIndex = resStart < weekDays[0] ? 0 : i
          break
        }
      }
      if (startDayIndex === -1 && resStart <= weekEnd) {
        startDayIndex = 0
      }

      // Find end day index (0-6 or 6 if after the week)
      let endDayIndex = 6
      for (let i = 6; i >= 0; i--) {
        if (isSameDay(weekDays[i], resEnd) || resEnd > weekDays[i]) {
          endDayIndex = resEnd > weekEnd ? 6 : i
          break
        }
      }

      return {
        reservation,
        startDayIndex: Math.max(0, startDayIndex),
        endDayIndex: Math.min(6, endDayIndex),
        row: 0,
        continuesBefore: resStart < weekStart,
        continuesAfter: resEnd > weekEnd,
      }
    }
  )

  // Assign rows using greedy algorithm
  const sortedSpanning = [...spanningReservations].sort((a, b) => {
    if (a.startDayIndex !== b.startDayIndex) {
      return a.startDayIndex - b.startDayIndex
    }
    // Longer spans first
    const spanA = a.endDayIndex - a.startDayIndex
    const spanB = b.endDayIndex - b.startDayIndex
    return spanB - spanA
  })

  const rowEndIndices: number[] = []

  const assignedSpanning = sortedSpanning.map((spanning) => {
    let row = 0
    while (
      row < rowEndIndices.length &&
      rowEndIndices[row] >= spanning.startDayIndex
    ) {
      row++
    }
    rowEndIndices[row] = spanning.endDayIndex

    return { ...spanning, row }
  })

  return {
    spanningReservations: assignedSpanning,
    maxRows: rowEndIndices.length,
  }
}

// =============================================================================
// Product Grouping for Timeline
// =============================================================================

/**
 * Groups reservations by product for the timeline view
 */
export function groupReservationsByProduct(
  reservations: Reservation[],
  products: Product[]
): TimelineProductRow[] {
  const productMap = new Map<string, Reservation[]>()

  // Initialize map with all products
  products.forEach((product) => {
    productMap.set(product.id, [])
  })

  // Group reservations by product
  reservations.forEach((reservation) => {
    reservation.items.forEach((item) => {
      const productId = item.product?.id
      if (productId && productMap.has(productId)) {
        const existing = productMap.get(productId) || []
        // Avoid duplicates
        if (!existing.some((r) => r.id === reservation.id)) {
          productMap.set(productId, [...existing, reservation])
        }
      }
    })
  })

  // Convert to TimelineProductRow array
  return products.map((product) => ({
    product,
    reservations: productMap.get(product.id) || [],
  }))
}

// =============================================================================
// Timeline Configuration Helpers
// =============================================================================

/**
 * Creates a timeline config for the current week
 */
export function createWeekConfig(date: Date): TimelineConfig {
  const startDate = getWeekStart(date)
  const endDate = getWeekEnd(date)
  return {
    startDate,
    endDate,
    daysCount: 7,
    zoom: 'week',
  }
}

/**
 * Creates a timeline config for two weeks (14 days)
 */
export function createTwoWeekConfig(date: Date): TimelineConfig {
  const startDate = getWeekStart(date)
  const endDate = new Date(startDate)
  endDate.setDate(startDate.getDate() + 13)
  return {
    startDate,
    endDate: endOfDay(endDate),
    daysCount: 14,
    zoom: 'week',
  }
}

/**
 * Creates a timeline config for a month
 */
export function createMonthConfig(date: Date): TimelineConfig {
  const startDate = new Date(date.getFullYear(), date.getMonth(), 1)
  const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const daysCount = endDate.getDate()

  return {
    startDate: startOfDay(startDate),
    endDate: endOfDay(endDate),
    daysCount,
    zoom: 'month',
  }
}

/**
 * Shifts a timeline config by a number of days
 */
export function shiftConfig(
  config: TimelineConfig,
  days: number
): TimelineConfig {
  const newStart = new Date(config.startDate)
  newStart.setDate(newStart.getDate() + days)

  const newEnd = new Date(config.endDate)
  newEnd.setDate(newEnd.getDate() + days)

  return {
    ...config,
    startDate: newStart,
    endDate: newEnd,
  }
}
