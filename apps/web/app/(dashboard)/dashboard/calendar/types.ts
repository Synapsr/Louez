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
  | 'quote'
  | 'declined'

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
  outboundMethod: string | null
  returnMethod: string | null
  deliveryOption: string | null
  deliveryAddress: string | null
  deliveryCity: string | null
  deliveryPostalCode: string | null
  deliveryCountry: string | null
  returnAddress: string | null
  returnCity: string | null
  returnPostalCode: string | null
  returnCountry: string | null
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
  pending: 'bg-reservation-pending',
  confirmed: 'bg-reservation-confirmed',
  ongoing: 'bg-reservation-ongoing',
  completed: 'bg-reservation-completed',
  cancelled: 'bg-reservation-cancelled',
  rejected: 'bg-reservation-rejected',
  quote: 'bg-reservation-quote',
  declined: 'bg-reservation-declined',
} as const

export const STATUS_COLORS_LIGHT: Record<ReservationStatus, string> = {
  pending: 'bg-reservation-pending-soft border-reservation-pending-border text-reservation-pending',
  confirmed: 'bg-reservation-confirmed-soft border-reservation-confirmed-border text-reservation-confirmed',
  ongoing: 'bg-reservation-ongoing-soft border-reservation-ongoing-border text-reservation-ongoing',
  completed: 'bg-reservation-completed-soft border-reservation-completed-border text-reservation-completed',
  cancelled: 'bg-reservation-cancelled-soft border-reservation-cancelled-border text-reservation-cancelled',
  rejected: 'bg-reservation-rejected-soft border-reservation-rejected-border text-reservation-rejected',
  quote: 'bg-reservation-quote-soft border-reservation-quote-border text-reservation-quote',
  declined: 'bg-reservation-declined-soft border-reservation-declined-border text-reservation-declined',
} as const
