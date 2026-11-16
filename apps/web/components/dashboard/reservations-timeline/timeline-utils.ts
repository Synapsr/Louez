/**
 * Pure helpers for reservation timelines (product page + planning view).
 *
 * All positioning is day-based: a date maps to an integer index relative to
 * the loaded window start, and bars span inclusive [startIndex, endIndex]
 * ranges. Keeping this math pure makes the scroll/window logic in the
 * component trivial to reason about (and testable).
 */

/** One product line of a reservation, as shown in the timeline tooltip */
import { getReservationRentalAmount } from "@/lib/reservations/util.rental-amount";

export interface TimelineReservationItem {
  name: string;
  quantity: number;
  /** Set when the line still points at a live product — drives the tooltip link */
  productId?: string | null;
  /** First product image, used as the tooltip thumbnail */
  imageUrl?: string | null;
}

/** Minimal reservation shape a timeline needs to place and render a bar */
export interface TimelineReservation {
  id: string;
  number: string;
  status: string | null;
  startDate: Date;
  endDate: Date;
  customerId: string | null;
  customerName: string;
  /** Rental subtotal, used to identify legacy totals that included the deposit */
  subtotalAmount?: string | null;
  /** Security deposit, displayed and accounted for separately from the rental */
  depositAmount?: string | null;
  totalAmount: string;
  /** Total quantity of the product across the reservation's line items */
  quantity: number;
  /** Product unit ids explicitly assigned to this reservation (tracked mode) */
  assignedUnitIds: string[];
  /**
   * Line items shown in the tooltip (aggregated per product, already ordered
   * with `compareByDisplayOrder`).
   */
  items?: TimelineReservationItem[];
  /** Customer address when the outbound leg is a delivery, null otherwise */
  outboundDeliveryAddress?: string | null;
  /** Customer address when the return leg is collected at the customer's */
  returnDeliveryAddress?: string | null;
}

/** The rental's price: its stored total, which never contains the deposit. */
export function getTimelineRentalAmount(
  reservation: Pick<TimelineReservation, "totalAmount">,
): number {
  return getReservationRentalAmount(reservation);
}

/**
 * Orders products the way the merchant configured their catalog (manual
 * `displayOrder` first, alphabetical fallback for stores that never touched
 * it) — the same order as the storefront and the product pickers, so a
 * reservation always reads the same way wherever it is displayed.
 */
export function compareByDisplayOrder(
  a: { name: string; displayOrder?: number | null },
  b: { name: string; displayOrder?: number | null },
): number {
  const byOrder = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
  return byOrder !== 0 ? byOrder : a.name.localeCompare(b.name);
}

/** Formats a delivery leg address for display ("12 rue X, 22620 Ploubazlanec, FR") */
export function formatDeliveryAddress(parts: {
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
}): string | null {
  const cityLine = [parts.postalCode, parts.city].filter(Boolean).join(" ");
  const formatted = [parts.address, cityLine, parts.country].filter(Boolean).join(", ");
  return formatted || null;
}

export interface TimelineDowntime {
  id: string;
  unitId: string;
  reason: "maintenance" | "repair" | "other";
  startsAt: Date;
  endsAt: Date | null;
}

const MS_PER_DAY = 86_400_000;

// =============================================================================
// Date helpers
// =============================================================================

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Whole days between the start-of-day of both dates (DST safe via rounding) */
export function diffInDays(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** Monday of the week containing the given date, at midnight */
export function getMondayOf(date: Date): Date {
  const result = startOfDay(date);
  const day = result.getDay();
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day));
  return result;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// =============================================================================
// Lanes
// =============================================================================

/** One horizontal row of the timeline — a physical unit of stock */
export interface TimelineLane {
  key: string;
  /** Product unit id for tracked products, null for simple quantity slots */
  unitId: string | null;
  label: string;
}

export interface TimelineDayRange {
  startIndex: number;
  endIndex: number;
}

type DayInterval = TimelineDayRange;

function toDayInterval(start: Date, end: Date, windowStart: Date): DayInterval {
  return {
    startIndex: diffInDays(windowStart, start),
    endIndex: diffInDays(windowStart, end),
  };
}

export function timelineRangesOverlap(a: TimelineDayRange, b: TimelineDayRange): boolean {
  return a.startIndex <= b.endIndex && a.endIndex >= b.startIndex;
}

export function findNearestTimelineItem<T extends TimelineDayRange>(
  items: readonly T[],
  visibleRange: TimelineDayRange,
): { item: T; direction: "previous" | "next" } | null {
  if (items.length === 0 || items.some((item) => timelineRangesOverlap(item, visibleRange))) {
    return null;
  }

  const distanceFromVisibleRange = (item: TimelineDayRange) =>
    item.endIndex < visibleRange.startIndex
      ? visibleRange.startIndex - item.endIndex
      : item.startIndex - visibleRange.endIndex;

  let nearest = items[0];
  let nearestDistance = distanceFromVisibleRange(nearest);

  for (const item of items.slice(1)) {
    const distance = distanceFromVisibleRange(item);
    if (distance < nearestDistance) {
      nearest = item;
      nearestDistance = distance;
    }
  }

  return {
    item: nearest,
    direction: nearest.endIndex < visibleRange.startIndex ? "previous" : "next",
  };
}

/**
 * Returns the side that needs one more loaded chunk before centering an item.
 * Keeping a buffer around the destination prevents edge-triggered infinite
 * loading from shifting the target during the navigation animation.
 */
export function getTimelineNavigationBufferDirection(params: {
  item: TimelineDayRange;
  dayWidth: number;
  daysCount: number;
  viewportWidth: number;
  edgeThreshold: number;
}): "previous" | "next" | null {
  const { item, dayWidth, daysCount, viewportWidth, edgeThreshold } = params;
  const itemCenter = (item.startIndex + item.endIndex) / 2;
  const targetScrollLeft = itemCenter * dayWidth - viewportWidth / 2;
  const maxScrollLeft = Math.max(0, daysCount * dayWidth - viewportWidth);

  if (targetScrollLeft < edgeThreshold) return "previous";
  if (maxScrollLeft - targetScrollLeft < edgeThreshold) return "next";
  return null;
}

// =============================================================================
// Reservation placement
// =============================================================================

export interface PlacedReservation extends DayInterval {
  reservation: TimelineReservation;
  laneIndex: number;
  /** True when no conflict-free lane was found (overbooking indicator) */
  isConflict: boolean;
}

export interface PlacedDowntime extends DayInterval {
  downtime: TimelineDowntime;
  laneIndex: number;
  /** True when the downtime has no end date (clipped to the window end) */
  isOpenEnded: boolean;
}

/**
 * Places downtimes on the lane of their unit, clipping open-ended downtimes
 * to the loaded window.
 */
export function placeDowntimes(params: {
  downtimes: TimelineDowntime[];
  lanes: TimelineLane[];
  windowStart: Date;
  daysCount: number;
}): PlacedDowntime[] {
  const { downtimes, lanes, windowStart, daysCount } = params;

  const laneIndexByUnitId = new Map<string, number>();
  lanes.forEach((lane, index) => {
    if (lane.unitId) laneIndexByUnitId.set(lane.unitId, index);
  });

  const placed: PlacedDowntime[] = [];
  for (const downtime of downtimes) {
    const laneIndex = laneIndexByUnitId.get(downtime.unitId);
    if (laneIndex === undefined) continue;

    const startIndex = diffInDays(windowStart, downtime.startsAt);
    const endIndex = downtime.endsAt ? diffInDays(windowStart, downtime.endsAt) : daysCount - 1;

    placed.push({
      downtime,
      laneIndex,
      startIndex,
      endIndex,
      isOpenEnded: !downtime.endsAt,
    });
  }

  return placed;
}

/**
 * Assigns reservations to unit lanes.
 *
 * 1. Explicit unit assignments (tracked products) always land on their unit's
 *    lane — that's ground truth from the reservation.
 * 2. Remaining quantity is bin-packed greedily onto lanes free of overlapping
 *    reservations AND downtimes.
 * 3. Anything left over (overbooking / more quantity than stock) is force
 *    placed round-robin and flagged `isConflict`.
 */
export function placeReservations(params: {
  reservations: TimelineReservation[];
  lanes: TimelineLane[];
  placedDowntimes: PlacedDowntime[];
  windowStart: Date;
}): PlacedReservation[] {
  const { reservations, lanes, placedDowntimes, windowStart } = params;

  if (lanes.length === 0) return [];

  const occupancy: DayInterval[][] = lanes.map(() => []);
  for (const placed of placedDowntimes) {
    occupancy[placed.laneIndex]?.push({
      startIndex: placed.startIndex,
      endIndex: placed.endIndex,
    });
  }

  const laneIndexByUnitId = new Map<string, number>();
  lanes.forEach((lane, index) => {
    if (lane.unitId) laneIndexByUnitId.set(lane.unitId, index);
  });

  const sorted = [...reservations].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  const result: PlacedReservation[] = [];
  let forceCursor = 0;

  for (const reservation of sorted) {
    const interval = toDayInterval(
      new Date(reservation.startDate),
      new Date(reservation.endDate),
      windowStart,
    );

    const usedLanes = new Set<number>();
    let remaining = Math.max(1, reservation.quantity);

    // 1. Explicit unit assignments
    for (const unitId of reservation.assignedUnitIds) {
      if (remaining === 0) break;
      const laneIndex = laneIndexByUnitId.get(unitId);
      if (laneIndex === undefined || usedLanes.has(laneIndex)) continue;

      occupancy[laneIndex].push(interval);
      usedLanes.add(laneIndex);
      result.push({
        reservation,
        laneIndex,
        ...interval,
        isConflict: false,
      });
      remaining--;
    }

    // 2. Greedy placement on free lanes
    for (let laneIndex = 0; laneIndex < lanes.length && remaining > 0; laneIndex++) {
      if (usedLanes.has(laneIndex)) continue;
      const isBusy = occupancy[laneIndex].some((busy) => timelineRangesOverlap(busy, interval));
      if (isBusy) continue;

      occupancy[laneIndex].push(interval);
      usedLanes.add(laneIndex);
      result.push({
        reservation,
        laneIndex,
        ...interval,
        isConflict: false,
      });
      remaining--;
    }

    // 3. Overflow — force place so the reservation stays visible
    while (remaining > 0) {
      const laneIndex = forceCursor % lanes.length;
      forceCursor++;
      if (usedLanes.has(laneIndex) && usedLanes.size < lanes.length) continue;

      occupancy[laneIndex].push(interval);
      usedLanes.add(laneIndex);
      result.push({
        reservation,
        laneIndex,
        ...interval,
        isConflict: true,
      });
      remaining--;
    }
  }

  return result;
}

/**
 * Stacks reservations into as few visual rows as possible (classic Gantt
 * stacking). Used for high-quantity untracked products where one lane per
 * physical unit would be meaningless (e.g. 200 chairs): row count grows with
 * concurrent reservations, not with stock size.
 */
export function stackReservations(params: {
  reservations: TimelineReservation[];
  windowStart: Date;
}): { placed: PlacedReservation[]; laneCount: number } {
  const { reservations, windowStart } = params;

  const sorted = [...reservations].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  const laneEndIndices: number[] = [];
  const placed: PlacedReservation[] = [];

  for (const reservation of sorted) {
    const interval = toDayInterval(
      new Date(reservation.startDate),
      new Date(reservation.endDate),
      windowStart,
    );

    let laneIndex = 0;
    while (laneIndex < laneEndIndices.length && laneEndIndices[laneIndex] >= interval.startIndex) {
      laneIndex++;
    }
    laneEndIndices[laneIndex] = interval.endIndex;

    placed.push({
      reservation,
      laneIndex,
      ...interval,
      isConflict: false,
    });
  }

  return { placed, laneCount: Math.max(1, laneEndIndices.length) };
}

// =============================================================================
// Daily availability
// =============================================================================

/** Statuses that actually hold stock (mirrors BLOCKING_RESERVATION_STATUSES) */
const BLOCKING_STATUSES = new Set(["pending", "confirmed", "ongoing"]);

/**
 * Free units per day over the window: total stock minus blocking reservation
 * quantities minus units under downtime. Clamped to [0, totalUnits].
 */
export function computeDailyAvailability(params: {
  reservations: TimelineReservation[];
  placedDowntimes: PlacedDowntime[];
  totalUnits: number;
  windowStart: Date;
  daysCount: number;
}): number[] {
  const { reservations, placedDowntimes, totalUnits, windowStart, daysCount } = params;

  const busy = Array.from({ length: daysCount }, () => 0);

  const addInterval = (interval: DayInterval, amount: number) => {
    const from = Math.max(0, interval.startIndex);
    const to = Math.min(daysCount - 1, interval.endIndex);
    for (let i = from; i <= to; i++) {
      busy[i] += amount;
    }
  };

  for (const reservation of reservations) {
    if (!BLOCKING_STATUSES.has(reservation.status ?? "")) continue;
    addInterval(
      toDayInterval(new Date(reservation.startDate), new Date(reservation.endDate), windowStart),
      Math.max(1, reservation.quantity),
    );
  }

  for (const placed of placedDowntimes) {
    addInterval(placed, 1);
  }

  return busy.map((count) => Math.min(totalUnits, Math.max(0, totalUnits - count)));
}

// =============================================================================
// Month segments (header)
// =============================================================================

export interface MonthSegment {
  /** First day index of the month within the window */
  startIndex: number;
  /** Number of days of this month visible in the window */
  days: number;
  /** Anchor date (first visible day of the month) for label formatting */
  date: Date;
}

export function computeMonthSegments(windowStart: Date, daysCount: number): MonthSegment[] {
  const segments: MonthSegment[] = [];
  let cursor = 0;

  while (cursor < daysCount) {
    const date = addDays(windowStart, cursor);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const daysLeftInMonth = diffInDays(date, monthEnd) + 1;
    const days = Math.min(daysLeftInMonth, daysCount - cursor);

    segments.push({ startIndex: cursor, days, date });
    cursor += days;
  }

  return segments;
}
