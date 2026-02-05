/**
 * Calendar module types
 *
 * This module provides type definitions for the calendar views,
 * including the timeline (Gantt-like) view optimized for rental businesses.
 */

// =============================================================================
// Core Types
// =============================================================================

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'ongoing'
  | 'completed'
  | 'cancelled'
  | 'rejected'

export type ViewMode = 'week' | 'month' | 'timeline'

export type TimelineZoom = 'day' | 'week' | 'month'

// =============================================================================
// Data Types
// =============================================================================

export interface ReservationItem {
  id: string
  quantity: number
  product: {
    id: string
    name: string
  } | null
  productSnapshot: {
    name: string
  } | null
}

export interface Reservation {
  id: string
  number: string
  status: ReservationStatus | null
  startDate: Date
  endDate: Date
  totalAmount: string
  customer: {
    id: string
    firstName: string
    lastName: string
  }
  items: ReservationItem[]
}

export interface Product {
  id: string
  name: string
  quantity: number
  categoryId?: string | null
}

export interface Category {
  id: string
  name: string
}

// =============================================================================
// Timeline View Types
// =============================================================================

/**
 * Represents a product row in the timeline view with its reservations
 */
export interface TimelineProductRow {
  product: Product
  category?: Category | null
  reservations: Reservation[]
}

/**
 * Represents a positioned reservation bar in the timeline
 * with calculated layout properties
 */
export interface PositionedReservation {
  reservation: Reservation
  /** Start position as percentage (0-100) of the visible timeline */
  startPercent: number
  /** Width as percentage (0-100) of the visible timeline */
  widthPercent: number
  /** Row index for stacking overlapping reservations */
  row: number
  /** Whether the reservation continues before the visible range */
  continuesBefore: boolean
  /** Whether the reservation continues after the visible range */
  continuesAfter: boolean
}

/**
 * Timeline view configuration
 */
export interface TimelineConfig {
  /** Start date of the visible range */
  startDate: Date
  /** End date of the visible range */
  endDate: Date
  /** Number of days visible */
  daysCount: number
  /** Zoom level */
  zoom: TimelineZoom
}

// =============================================================================
// Week View Types (Enhanced with spanning bars)
// =============================================================================

/**
 * Represents a reservation spanning multiple days in the week view
 */
export interface SpanningReservation {
  reservation: Reservation
  /** Day index where the reservation starts in the current week (0-6, or -1 if before) */
  startDayIndex: number
  /** Day index where the reservation ends in the current week (0-6, or 7 if after) */
  endDayIndex: number
  /** Row index for stacking */
  row: number
  /** Whether it starts before this week */
  continuesBefore: boolean
  /** Whether it continues after this week */
  continuesAfter: boolean
}

/**
 * Layout information for a week
 */
export interface WeekLayout {
  /** All spanning reservations for the week, positioned */
  spanningReservations: SpanningReservation[]
  /** Maximum row count (for calculating container height) */
  maxRows: number
}

// =============================================================================
// Event Handlers
// =============================================================================

export interface CalendarEventHandlers {
  onReservationClick?: (reservation: Reservation) => void
  onDateClick?: (date: Date) => void
  onDateRangeSelect?: (startDate: Date, endDate: Date) => void
}

// =============================================================================
// Component Props
// =============================================================================

export interface CalendarViewProps {
  initialReservations: Reservation[]
  products: Product[]
  categories?: Category[]
  storeId: string
}

export interface TimelineViewProps {
  reservations: Reservation[]
  products: Product[]
  categories?: Category[]
  config: TimelineConfig
  onConfigChange: (config: Partial<TimelineConfig>) => void
}

export interface ReservationBarProps {
  reservation: Reservation
  continuesBefore?: boolean
  continuesAfter?: boolean
  compact?: boolean
  className?: string
}

// =============================================================================
// Status Configuration
// =============================================================================

export const STATUS_COLORS: Record<ReservationStatus, string> = {
  pending: 'bg-yellow-500',
  confirmed: 'bg-green-500',
  ongoing: 'bg-blue-500',
  completed: 'bg-gray-400',
  cancelled: 'bg-red-300',
  rejected: 'bg-red-400',
} as const

export const STATUS_COLORS_LIGHT: Record<ReservationStatus, string> = {
  pending: 'bg-yellow-100 border-yellow-300 text-yellow-800',
  confirmed: 'bg-green-100 border-green-300 text-green-800',
  ongoing: 'bg-blue-100 border-blue-300 text-blue-800',
  completed: 'bg-gray-100 border-gray-300 text-gray-600',
  cancelled: 'bg-red-50 border-red-200 text-red-600',
  rejected: 'bg-red-100 border-red-300 text-red-700',
} as const
