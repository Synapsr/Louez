import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { alias } from "drizzle-orm/mysql-core";
import { db, effectiveProductQuantitySql, isStripeRefundPaymentSql, payments } from "@louez/db";
import { products, reservationItems, reservations } from "@louez/db";

import { getSalesGrowth, type SalesWindow } from "./util.sales-window";

type ReservationStatus = (typeof reservations.status.enumValues)[number];

/** Reservations that actually mobilise units — quotes and cancellations excluded. */
const OCCUPYING_STATUSES: ReservationStatus[] = ["confirmed", "ongoing", "completed"];

/** Reservations that count as booked activity, whatever their outcome so far. */
const BOOKED_STATUSES: ReservationStatus[] = ["pending", "confirmed", "ongoing", "completed"];

const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = MINUTES_PER_DAY * 60_000;

export interface OccupancyStats {
  /** Occupied unit-days over available unit-days, in percent. */
  rate: number;
  /** Units the active catalog offers — the denominator's fleet size. */
  availableUnits: number;
}

/**
 * How much of the fleet was actually out over the window: every reservation
 * item contributes `quantity × days` for the part of its stay that falls inside
 * the window, measured against the unit-days the active catalog could offer.
 */
export async function getOccupancyStats(
  storeId: string,
  window: SalesWindow,
): Promise<OccupancyStats> {
  const { start, end } = window;
  const days = (end.getTime() - start.getTime()) / MS_PER_DAY;

  const [occupied, fleet] = await Promise.all([
    db
      .select({
        unitDays: sql<string>`COALESCE(SUM(${reservationItems.quantity} * GREATEST(TIMESTAMPDIFF(MINUTE, GREATEST(${reservations.startDate}, ${start}), LEAST(${reservations.endDate}, ${end})), 0) / ${MINUTES_PER_DAY}), 0)`,
      })
      .from(reservationItems)
      .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
      .innerJoin(products, eq(reservationItems.productId, products.id))
      .where(
        and(
          eq(reservations.storeId, storeId),
          eq(products.storeId, storeId),
          eq(products.status, "active"),
          eq(products.stockKind, "returnable"),
          inArray(reservations.status, OCCUPYING_STATUSES),
          // Only the stays overlapping the window can contribute unit-days.
          lt(reservations.startDate, end),
          gte(reservations.endDate, start),
        ),
      ),
    db
      .select({ units: sql<string>`COALESCE(SUM(${effectiveProductQuantitySql()}), 0)` })
      .from(products)
      .where(
        and(
          eq(products.storeId, storeId),
          eq(products.status, "active"),
          eq(products.stockKind, "returnable"),
        ),
      ),
  ]);

  const availableUnits = Number(fleet[0]?.units || 0);
  const availableUnitDays = availableUnits * days;
  const occupiedUnitDays = parseFloat(occupied[0]?.unitDays || "0");

  return {
    rate: availableUnitDays > 0 ? (occupiedUnitDays / availableUnitDays) * 100 : 0,
    availableUnits,
  };
}

export interface UpcomingRevenueStats {
  revenue: number;
  reservationCount: number;
}

/** Outstanding rental balances of confirmed future reservations, after rental refunds. */
export async function getUpcomingRevenue(
  storeId: string,
  now: Date,
): Promise<UpcomingRevenueStats> {
  const original = alias(payments, "original_payment");
  const paid = db
    .select({
      reservationId: payments.reservationId,
      amount: sql<string>`SUM(CASE
      WHEN ${isStripeRefundPaymentSql()} THEN 0
      WHEN ${payments.refundOfPaymentId} IS NULL AND ${payments.type} = 'rental' THEN ${payments.amount}
      WHEN ${original.type} = 'rental' AND ${original.status} = 'completed' THEN -${payments.amount}
      ELSE 0 END)`.as("net_paid"),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .leftJoin(
      original,
      and(
        eq(payments.refundOfPaymentId, original.id),
        eq(payments.reservationId, original.reservationId),
      ),
    )
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(payments.status, "completed"),
        sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) < ${now}`,
      ),
    )
    .groupBy(payments.reservationId)
    .as("rental_paid");

  // Match the reservation payment form's handling of older totals that include a deposit.
  const rentalAmount = sql`CASE
    WHEN ${reservations.totalAmount} <= 0 THEN ${reservations.subtotalAmount}
    WHEN ${reservations.depositAmount} > 0 AND ${reservations.totalAmount} - ${reservations.subtotalAmount} >= ${reservations.depositAmount} - 0.01
      THEN GREATEST(0, ${reservations.totalAmount} - ${reservations.depositAmount})
    ELSE ${reservations.totalAmount} END`;
  const remaining = sql`GREATEST(0, ${rentalAmount} - GREATEST(0, COALESCE(${paid.amount}, 0)))`;
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${remaining}), 0)`,
      reservationCount: count(),
    })
    .from(reservations)
    .leftJoin(paid, eq(paid.reservationId, reservations.id))
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, "confirmed"),
        gte(reservations.startDate, now),
        sql`${remaining} > 0`,
      ),
    );
  return { revenue: Number(row?.total ?? 0), reservationCount: Number(row?.reservationCount ?? 0) };
}

export interface AverageRentalDurationStats {
  /** `null` when no reservation started over the window. */
  avgMinutes: number | null;
  reservationCount: number;
}

/** Average stay length of the reservations that started over the window. */
export async function getAverageRentalDuration(
  storeId: string,
  window: SalesWindow,
): Promise<AverageRentalDurationStats> {
  const { start, end } = window;

  const rows = await db
    .select({
      avgMinutes: sql<
        string | null
      >`AVG(TIMESTAMPDIFF(MINUTE, ${reservations.startDate}, ${reservations.endDate}))`,
      reservationCount: count(),
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        inArray(reservations.status, OCCUPYING_STATUSES),
        gte(reservations.startDate, start),
        lt(reservations.startDate, end),
      ),
    );

  const avgMinutes = rows[0]?.avgMinutes;

  return {
    avgMinutes: avgMinutes === null || avgMinutes === undefined ? null : Number(avgMinutes),
    reservationCount: rows[0]?.reservationCount || 0,
  };
}

export interface PeriodReservationStats {
  reservationCount: number;
  growth: number | null;
}

/**
 * Reservations starting over the window, compared with the window of the same
 * length right before it.
 */
export async function getPeriodReservationStats(
  storeId: string,
  window: SalesWindow,
): Promise<PeriodReservationStats> {
  const { start, end } = window;
  const countStartingBetween = (from: Date, to: Date) =>
    db
      .select({ reservationCount: count() })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, storeId),
          inArray(reservations.status, BOOKED_STATUSES),
          gte(reservations.startDate, from),
          lt(reservations.startDate, to),
        ),
      );

  const [current, previous] = await Promise.all([
    countStartingBetween(start, end),
    countStartingBetween(window.previousStart, window.previousEnd),
  ]);

  const reservationCount = current[0]?.reservationCount || 0;
  const previousCount = previous[0]?.reservationCount || 0;

  return {
    reservationCount,
    growth: getSalesGrowth(reservationCount, previousCount),
  };
}
