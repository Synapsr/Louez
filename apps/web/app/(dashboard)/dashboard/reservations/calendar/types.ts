/**
 * Calendar module types
 *
 * This module provides type definitions for the calendar views,
 * including the timeline (Gantt-like) view optimized for rental businesses.
 */

import type { TimelineReservation } from "@/components/dashboard/reservations-timeline/timeline-utils";

// =============================================================================
// Core Types
// =============================================================================

export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled"
  | "rejected"
  | "quote"
  | "declined";

export type TimelineZoom = "day" | "week" | "month";

// =============================================================================
// Data Types
// =============================================================================

export interface ReservationItem {
  id: string;
  quantity: number;
  product: {
    id: string;
    name: string;
    images?: string[] | null;
    /** Catalog order, mirrored in the reservation tooltips */
    displayOrder?: number | null;
  } | null;
  productSnapshot: {
    name: string;
    images?: string[] | null;
  } | null;
}

export interface Reservation {
  id: string;
  number: string;
  status: ReservationStatus | null;
  startDate: Date;
  endDate: Date;
  subtotalAmount: string;
  depositAmount: string;
  totalAmount: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  items: ReservationItem[];
  // Delivery legs — 'address' means the merchant travels to the customer
  outboundMethod: string;
  returnMethod: string;
  deliveryAddress: string | null;
  deliveryCity: string | null;
  deliveryPostalCode: string | null;
  deliveryCountry: string | null;
  returnAddress: string | null;
  returnCity: string | null;
  returnPostalCode: string | null;
  returnCountry: string | null;
}

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
