/**
 * Calendar module types
 *
 * This module provides type definitions for the calendar views,
 * including the timeline (Gantt-like) view optimized for rental businesses.
 */

import type { ReservationCalendarPeriodEntry } from "@louez/validations";

import type { TimelineReservation } from "@/components/dashboard/reservations-timeline/timeline-utils";

// =============================================================================
// Core Types
// =============================================================================

export type TimelineZoom = "day" | "week" | "month";

// =============================================================================
// Data Types
// =============================================================================

export type Reservation = ReservationCalendarPeriodEntry;

/**
 * A planning-timeline entry: one bar for a single (reservation, product) pair,
 * so a reservation covering several products lands on each product's own rows.
 */
export interface StoreTimelineReservation extends TimelineReservation {
  productId: string;
}

export interface ProductUnit {
  id: string;
  identifier: string;
}

export interface Product {
  id: string;
  name: string;
  quantity: number;
  images?: string[] | null;
  categoryId?: string | null;
  /** Unit-tracked products get one planning row per real unit */
  trackUnits?: boolean;
  /** Active units, empty for simple-quantity products */
  units?: ProductUnit[];
}

// =============================================================================
// Timeline View Types
// =============================================================================

/**
 * Timeline view configuration
 */
export interface TimelineConfig {
  /** Start date of the visible range */
  startDate: Date;
  /** End date of the visible range */
  endDate: Date;
  /** Number of days visible */
  daysCount: number;
  /** Zoom level */
  zoom: TimelineZoom;
}
