import { endOfDay, subDays } from "date-fns";

import { and, asc, countDistinct, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import {
  BLOCKING_RESERVATION_STATUSES,
  customers,
  db,
  findBusyUnitIds,
  getBlockingReservationStatuses,
  isPaymentReceiptSql,
  payments,
  productUnitDowntimes,
  productUnitEvents,
  productUnits,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
  stores,
  users,
} from "@louez/db";
import {
  type GetUnitDowntimesInput,
  type GetUnitTimelineInput,
  getUnitDowntimesSchema,
  getUnitTimelineSchema,
} from "@louez/validations";

import type { Reservation } from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import { getCurrentStore } from "@/lib/store-context";
import { getUnitConflictFlags } from "@/lib/utils/unit-conflicts";

/**
 * Read-only data-layer queries for the product dashboard (view) page.
 *
 * These are plain server-side reads (no `'use server'` directive) meant to be
 * called directly from a server component. They intentionally do not mutate
 * anything.
 */

// ============================================================================
// 1. Revenue stats
// ============================================================================

export interface ProductRevenueStats {
  allTimeRevenue: number;
  last30DaysRevenue: number;
  previous30DaysRevenue: number;
  revenueGrowth: number;
  reservationCount: number;
}

interface ProductRentalPaymentStats {
  revenue: number;
  reservationCount: number;
}

/** Allocate rental receipts by line-item price, matching the sales product ranking. */
async function getProductRentalPaymentStats(params: {
  storeId: string;
  productId: string;
  startDate?: Date;
  endDateExclusive?: Date;
}): Promise<ProductRentalPaymentStats> {
  const { storeId, productId, startDate, endDateExclusive } = params;

  const itemTotals = db
    .select({
      reservationId: reservationItems.reservationId,
      total: sql<string>`SUM(${reservationItems.totalPrice})`.as("item_total"),
      productTotal:
        sql<string>`SUM(CASE WHEN ${reservationItems.productId} = ${productId} THEN ${reservationItems.totalPrice} ELSE 0 END)`.as(
          "product_total",
        ),
    })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(eq(reservations.storeId, storeId))
    .groupBy(reservationItems.reservationId)
    .having(sql`SUM(CASE WHEN ${reservationItems.productId} = ${productId} THEN 1 ELSE 0 END) > 0`)
    .as("item_totals");

  const allocatedRevenue = sql`CASE WHEN ${itemTotals.total} > 0 THEN ${payments.amount} * ${itemTotals.productTotal} / ${itemTotals.total} ELSE 0 END`;

  const dateConditions = [
    ...(startDate
      ? [sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) >= ${startDate}`]
      : []),
    ...(endDateExclusive
      ? [sql`COALESCE(${payments.paidAt}, ${payments.createdAt}) < ${endDateExclusive}`]
      : []),
  ];

  const result = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${allocatedRevenue}), 0)`,
      reservationCount: sql<number>`COUNT(DISTINCT ${payments.reservationId})`,
    })
    .from(payments)
    .innerJoin(itemTotals, eq(payments.reservationId, itemTotals.reservationId))
    .where(
      and(
        eq(payments.status, "completed"),
        eq(payments.type, "rental"),
        isPaymentReceiptSql(),
        ...dateConditions,
      ),
    );

  return {
    revenue: parseFloat(result[0]?.revenue || "0"),
    reservationCount: result[0]?.reservationCount || 0,
  };
}

export async function getProductRevenueStats(params: {
  storeId: string;
  productId: string;
}): Promise<ProductRevenueStats> {
  const { storeId, productId } = params;
  const now = new Date();
  const last30DaysStart = subDays(now, 30);
  const previous30DaysStart = subDays(now, 60);

  // Compare two contiguous rolling periods so the KPI is independent of
  // calendar-month length and never counts a boundary payment twice.
  const [last30Days, previous30Days, allTime] = await Promise.all([
    getProductRentalPaymentStats({
      storeId,
      productId,
      startDate: last30DaysStart,
      endDateExclusive: now,
    }),
    getProductRentalPaymentStats({
      storeId,
      productId,
      startDate: previous30DaysStart,
      endDateExclusive: last30DaysStart,
    }),
    getProductRentalPaymentStats({ storeId, productId }),
  ]);

  const revenueGrowth =
    previous30Days.revenue > 0
      ? ((last30Days.revenue - previous30Days.revenue) / previous30Days.revenue) * 100
      : 0;

  return {
    allTimeRevenue: allTime.revenue,
    last30DaysRevenue: last30Days.revenue,
    previous30DaysRevenue: previous30Days.revenue,
    revenueGrowth,
    reservationCount: allTime.reservationCount,
  };
}

// ============================================================================
// 2. Reservation counts by status
// ============================================================================

const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "ongoing",
  "completed",
  "cancelled",
  "rejected",
  "quote",
  "declined",
] as const;

export type ProductReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * Reservation counts for a product, keyed by `reservations.status`. All eight
 * statuses are always present (defaulted to 0) so callers don't need to guard
 * against missing keys.
 */
export async function getProductReservationCounts(params: {
  storeId: string;
  productId: string;
}): Promise<Record<ProductReservationStatus, number>> {
  const { storeId, productId } = params;

  const rows = await db
    .select({
      status: reservations.status,
      // A reservation could (rarely) have more than one line item for this
      // product; dedupe by reservation id so it's only counted once.
      count: sql<number>`COUNT(DISTINCT ${reservations.id})`,
    })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(and(eq(reservations.storeId, storeId), eq(reservationItems.productId, productId)))
    .groupBy(reservations.status);

  const counts = Object.fromEntries(RESERVATION_STATUSES.map((status) => [status, 0])) as Record<
    ProductReservationStatus,
    number
  >;

  for (const row of rows) {
    counts[row.status] = Number(row.count);
  }

  return counts;
}

// ============================================================================
// 3. Utilization rate
// ============================================================================

export interface ProductUtilizationRate {
  /** Fraction in [0, 1] of capacity-days used over the window (NOT a 0-100 percentage). */
  rate: number;
  busyDays: number;
  totalCapacityDays: number;
}

/**
 * Computes how much of a product's capacity was used over a trailing window.
 *
 * `rate` is expressed as a FRACTION in [0, 1] (e.g. 0.42 = 42% utilized), not
 * a 0-100 percentage — multiply by 100 to render as a percentage.
 *
 * `totalUnits` means different things depending on `trackUnits`:
 * - trackUnits = true: the number of units to treat as "total capacity" for
 *   this calculation (e.g. the active unit count). The caller decides this.
 * - trackUnits = false: the product's flat `quantity` stock.
 *
 * "Busy" is defined using the same blocking-reservation-status set used for
 * unit availability everywhere else (`BLOCKING_RESERVATION_STATUSES`:
 * pending/confirmed/ongoing) — this intentionally does NOT consult the
 * store's `pendingBlocksAvailability` setting, since this metric describes
 * historical/ongoing occupancy rather than "can this be booked right now".
 */
export async function getProductUtilizationRate(params: {
  storeId: string;
  productId: string;
  trackUnits: boolean;
  totalUnits: number;
  windowDays?: number;
}): Promise<ProductUtilizationRate> {
  const { storeId, productId, trackUnits, totalUnits, windowDays = 30 } = params;
  const now = new Date();
  const windowStart = subDays(now, windowDays);

  // Overlap (in days) between each reservation's [startDate, endDate] and the
  // trailing window [windowStart, now], clamped to >= 0. MySQL-compatible
  // (GREATEST/LEAST/TIMESTAMPDIFF), no Postgres-only syntax.
  const overlapDaysExpr = sql`GREATEST(
    0,
    TIMESTAMPDIFF(
      SECOND,
      GREATEST(${reservations.startDate}, ${windowStart}),
      LEAST(${reservations.endDate}, ${now})
    ) / 86400
  )`;

  const [row] = trackUnits
    ? await db
        .select({
          busyUnitDays: sql<string>`COALESCE(SUM(${overlapDaysExpr}), 0)`,
        })
        .from(reservationItemUnits)
        .innerJoin(
          reservationItems,
          eq(reservationItemUnits.reservationItemId, reservationItems.id),
        )
        .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservationItems.productId, productId),
            inArray(reservations.status, BLOCKING_RESERVATION_STATUSES),
          ),
        )
    : await db
        .select({
          busyUnitDays: sql<string>`COALESCE(SUM(${reservationItems.quantity} * ${overlapDaysExpr}), 0)`,
        })
        .from(reservationItems)
        .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
        .where(
          and(
            eq(reservations.storeId, storeId),
            eq(reservationItems.productId, productId),
            inArray(reservations.status, BLOCKING_RESERVATION_STATUSES),
          ),
        );

  const busyDays = parseFloat(row?.busyUnitDays || "0");
  const totalCapacityDays = totalUnits * windowDays;
  const rate = totalCapacityDays > 0 ? Math.min(1, Math.max(0, busyDays / totalCapacityDays)) : 0;

  return { rate, busyDays, totalCapacityDays };
}

// ============================================================================
// 4. Inventory detail
// ============================================================================

export type InventoryDowntimeSummary = {
  id: string;
  reason: "maintenance" | "repair" | "other";
  startsAt: Date;
  endsAt: Date | null;
  note: string | null;
};

export type ProductInventoryDetail =
  | {
      mode: "simple";
      quantity: number;
      effectiveQuantity: number;
    }
  | {
      mode: "tracked";
      units: Array<{
        id: string;
        identifier: string;
        attributes: unknown;
        lifecycleStatus: "active" | "retired";
        retiredAt: Date | null;
        retirementReason: string | null;
        notes: string | null;
        purchasePrice: string | null;
        purchasedAt: Date | null;
        currentDowntime: InventoryDowntimeSummary | null;
        isBusyToday: boolean;
        hasConflicts: boolean;
      }>;
    };

/**
 * Shape of a single unit within `ProductInventoryDetail`'s `mode: 'tracked'`
 * branch. Exported for reuse by the unit-lifecycle dialogs/cells under
 * `./components/inventory/`.
 */
export type ProductInventoryUnit = Extract<
  ProductInventoryDetail,
  { mode: "tracked" }
>["units"][number];

/**
 * Full inventory view for a product (unlike the edit form, which only loads
 * active units — this includes retired units too, for a complete history).
 */
export async function getProductInventoryDetail(params: {
  storeId: string;
  productId: string;
  trackUnits: boolean;
}): Promise<ProductInventoryDetail> {
  const { storeId, productId, trackUnits } = params;

  if (!trackUnits) {
    // getEffectiveProductQuantities only aggregates active productUnits rows
    // and is meaningless for non-tracked products (it wouldn't return an
    // entry for them at all) — for simple-mode products, effective quantity
    // is just the flat `quantity` column.
    const [product] = await db
      .select({ quantity: products.quantity })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.storeId, storeId)));

    const quantity = product?.quantity ?? 0;
    return { mode: "simple", quantity, effectiveQuantity: quantity };
  }

  const units = await db
    .select()
    .from(productUnits)
    .where(eq(productUnits.productId, productId))
    .orderBy(asc(productUnits.identifier));

  if (units.length === 0) {
    return { mode: "tracked", units: [] };
  }

  const unitIds = units.map((unit) => unit.id);
  const now = new Date();

  const [store, openDowntimes] = await Promise.all([
    db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: { settings: true },
    }),
    db
      .select()
      .from(productUnitDowntimes)
      .where(
        and(
          inArray(productUnitDowntimes.productUnitId, unitIds),
          eq(productUnitDowntimes.storeId, storeId),
          or(isNull(productUnitDowntimes.endsAt), gt(productUnitDowntimes.endsAt, now)),
        ),
      ),
  ]);

  // Mirrors apps/web/app/(dashboard)/dashboard/products/[id]/page.tsx's
  // edit-page pattern for deriving the blocking statuses from the store's
  // `pendingBlocksAvailability` setting.
  const blockingStatuses = getBlockingReservationStatuses(
    store?.settings?.pendingBlocksAvailability ?? true,
  );
  const turnoverBufferMinutes = store?.settings?.turnoverBufferMinutes ?? 0;

  const busyUnitIds = await findBusyUnitIds(db, {
    unitIds,
    start: now,
    end: endOfDay(now),
    blockingStatuses,
    turnoverBufferMinutes,
  });

  const openDowntimeByUnit = new Map<string, (typeof openDowntimes)[number]>();
  const openDowntimesByUnit = new Map<string, typeof openDowntimes>();
  for (const downtime of openDowntimes) {
    if (!downtime.productUnitId) continue;
    if (!openDowntimeByUnit.has(downtime.productUnitId)) {
      openDowntimeByUnit.set(downtime.productUnitId, downtime);
    }

    const list = openDowntimesByUnit.get(downtime.productUnitId) ?? [];
    list.push(downtime);
    openDowntimesByUnit.set(downtime.productUnitId, list);
  }

  // Mirrors the old `dashboard/inventory` page's `getInventory` conflict-flag
  // computation (deleted): retired units are treated as conflicting with any
  // future assignment (open-ended window from now), while active units are
  // checked against the windows of their current/upcoming (still-open)
  // downtimes.
  const conflictWindows = units.flatMap((unit) => {
    if (unit.lifecycleStatus === "retired") {
      return [{ unitId: unit.id, window: { start: now, end: null } }];
    }

    const unitOpenDowntimes = openDowntimesByUnit.get(unit.id) ?? [];
    return unitOpenDowntimes.map((downtime) => ({
      unitId: unit.id,
      window: { start: downtime.startsAt, end: downtime.endsAt },
    }));
  });

  const conflictFlags = await getUnitConflictFlags(conflictWindows, {
    storeId,
    pendingBlocksAvailability: store?.settings?.pendingBlocksAvailability,
    turnoverBufferMinutes,
  });

  return {
    mode: "tracked",
    units: units.map((unit) => {
      const downtime = openDowntimeByUnit.get(unit.id);

      return {
        id: unit.id,
        identifier: unit.identifier,
        attributes: unit.attributes,
        lifecycleStatus: unit.lifecycleStatus,
        retiredAt: unit.retiredAt,
        retirementReason: unit.retirementReason,
        notes: unit.notes,
        purchasePrice: unit.purchasePrice,
        purchasedAt: unit.purchasedAt,
        currentDowntime: downtime
          ? {
              id: downtime.id,
              reason: downtime.reason,
              startsAt: downtime.startsAt,
              endsAt: downtime.endsAt,
              note: downtime.note,
            }
          : null,
        isBusyToday: busyUnitIds.has(unit.id),
        hasConflicts: conflictFlags[unit.id] ?? false,
      };
    }),
  };
}

// ============================================================================
// 5. Reservations page (paginated)
// ============================================================================

/**
 * Paginated list of reservations that include this product, ONE ROW PER
 * RESERVATION, loaded with the full relational shape (`customer`, `items`,
 * `payments`) so the section can render the shared `ReservationsCardView`
 * users know from the reservations page. `page` is zero-indexed.
 */
export async function getProductReservationsPage(params: {
  storeId: string;
  productId: string;
  page: number;
  pageSize: number;
}): Promise<{ items: Reservation[]; total: number }> {
  const { storeId, productId, page, pageSize } = params;

  const whereClause = and(
    eq(reservations.storeId, storeId),
    eq(reservationItems.productId, productId),
  );

  const [idRows, [{ total }]] = await Promise.all([
    db
      .selectDistinct({
        id: reservations.id,
        startDate: reservations.startDate,
      })
      .from(reservationItems)
      .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
      .where(whereClause)
      .orderBy(desc(reservations.startDate), desc(reservations.id))
      .limit(pageSize)
      .offset(page * pageSize),
    db
      .select({ total: countDistinct(reservations.id) })
      .from(reservationItems)
      .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
      .where(whereClause),
  ]);

  if (idRows.length === 0) {
    return { items: [], total };
  }

  const items = await db.query.reservations.findMany({
    where: inArray(
      reservations.id,
      idRows.map((row) => row.id),
    ),
    with: {
      customer: true,
      items: { with: { product: true } },
      payments: true,
    },
    orderBy: (reservations, { desc }) => [
      desc(reservations.startDate),
      desc(reservations.id),
    ],
  });

  return { items: items as unknown as Reservation[], total };
}

// ============================================================================
// 7. Unit timeline & downtimes (relocated from the deleted standalone
//    `dashboard/inventory` page — unit-lifecycle detail reads used by the
//    unit history sheet under `./components/inventory/`)
// ============================================================================

export type UnitTimelineEntry =
  | {
      kind: "event";
      id: string;
      type: (typeof productUnitEvents.$inferSelect)["type"];
      actorUserId: string | null;
      actorName: string | null;
      payload: Record<string, unknown> | null;
      createdAt: Date;
    }
  | {
      kind: "assignment";
      id: string;
      type: "assigned";
      reservationId: string;
      reservationNumber: string;
      reservationItemId: string;
      identifierSnapshot: string;
      customerName: string | null;
      startDate: Date;
      endDate: Date;
      createdAt: Date;
    };

export type UnitDowntimeStatus = "current" | "upcoming" | "past";

export type UnitDowntimeEntry = {
  id: string;
  reason: "maintenance" | "repair" | "other";
  startsAt: Date;
  endsAt: Date | null;
  note: string | null;
  status: UnitDowntimeStatus;
};

function getDowntimeStatus(
  downtime: Pick<UnitDowntimeEntry, "startsAt" | "endsAt">,
  now: Date,
): UnitDowntimeStatus {
  if (downtime.startsAt <= now && (!downtime.endsAt || downtime.endsAt > now)) {
    return "current";
  }

  if (downtime.startsAt > now) {
    return "upcoming";
  }

  return "past";
}

function getDowntimeStatusOrder(status: UnitDowntimeStatus): number {
  if (status === "current") {
    return 0;
  }

  if (status === "upcoming") {
    return 1;
  }

  return 2;
}

export async function getUnitTimeline(input: GetUnitTimelineInput) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const validated = getUnitTimelineSchema.safeParse(input);
  if (!validated.success) {
    return { error: "errors.invalidData" };
  }

  const [unit] = await db
    .select({ id: productUnits.id })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(and(eq(productUnits.id, validated.data.unitId), eq(products.storeId, store.id)))
    .limit(1);

  if (!unit) {
    return { error: "errors.notFound" };
  }

  const [events, assignments] = await Promise.all([
    db
      .select({
        id: productUnitEvents.id,
        type: productUnitEvents.type,
        actorUserId: productUnitEvents.actorUserId,
        actorName: users.name,
        payload: productUnitEvents.payload,
        createdAt: productUnitEvents.createdAt,
      })
      .from(productUnitEvents)
      .leftJoin(users, eq(productUnitEvents.actorUserId, users.id))
      .where(
        and(
          eq(productUnitEvents.productUnitId, validated.data.unitId),
          eq(productUnitEvents.storeId, store.id),
        ),
      )
      .orderBy(desc(productUnitEvents.createdAt)),
    db
      .select({
        id: reservationItemUnits.id,
        reservationId: reservations.id,
        reservationNumber: reservations.number,
        reservationItemId: reservationItems.id,
        identifierSnapshot: reservationItemUnits.identifierSnapshot,
        customerName: sql<
          string | null
        >`NULLIF(TRIM(CONCAT(COALESCE(${customers.firstName}, ''), ' ', COALESCE(${customers.lastName}, ''))), '')`,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
        assignedAt: reservationItemUnits.assignedAt,
      })
      .from(reservationItemUnits)
      .innerJoin(reservationItems, eq(reservationItemUnits.reservationItemId, reservationItems.id))
      .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(
        and(
          eq(reservationItemUnits.productUnitId, validated.data.unitId),
          eq(reservations.storeId, store.id),
        ),
      ),
  ]);

  const eventEntries: UnitTimelineEntry[] = events.map((event) => ({
    kind: "event",
    id: event.id,
    type: event.type,
    actorUserId: event.actorUserId,
    actorName: event.actorName,
    payload: event.payload ?? null,
    createdAt: event.createdAt,
  }));
  const assignmentEntries: UnitTimelineEntry[] = assignments.map((assignment) => ({
    kind: "assignment",
    id: assignment.id,
    type: "assigned",
    reservationId: assignment.reservationId,
    reservationNumber: assignment.reservationNumber,
    reservationItemId: assignment.reservationItemId,
    identifierSnapshot: assignment.identifierSnapshot,
    customerName: assignment.customerName,
    startDate: assignment.startDate,
    endDate: assignment.endDate,
    createdAt: assignment.assignedAt,
  }));
  const timeline = [...eventEntries, ...assignmentEntries].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  return { success: true, timeline };
}

export async function getUnitDowntimes(input: GetUnitDowntimesInput) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const validated = getUnitDowntimesSchema.safeParse(input);
  if (!validated.success) {
    return { error: "errors.invalidData" };
  }

  const [unit] = await db
    .select({ id: productUnits.id })
    .from(productUnits)
    .innerJoin(products, eq(productUnits.productId, products.id))
    .where(and(eq(productUnits.id, validated.data.unitId), eq(products.storeId, store.id)))
    .limit(1);

  if (!unit) {
    return { error: "errors.notFound" };
  }

  const rows = await db
    .select({
      id: productUnitDowntimes.id,
      reason: productUnitDowntimes.reason,
      startsAt: productUnitDowntimes.startsAt,
      endsAt: productUnitDowntimes.endsAt,
      note: productUnitDowntimes.note,
    })
    .from(productUnitDowntimes)
    .where(
      and(
        eq(productUnitDowntimes.productUnitId, validated.data.unitId),
        eq(productUnitDowntimes.storeId, store.id),
      ),
    );

  const now = new Date();
  const downtimes: UnitDowntimeEntry[] = rows
    .map((row) => ({
      ...row,
      status: getDowntimeStatus(row, now),
    }))
    .sort((a, b) => {
      const statusOrder = getDowntimeStatusOrder(a.status) - getDowntimeStatusOrder(b.status);
      if (statusOrder !== 0) {
        return statusOrder;
      }

      if (a.status === "upcoming") {
        return a.startsAt.getTime() - b.startsAt.getTime();
      }

      return b.startsAt.getTime() - a.startsAt.getTime();
    });

  return { success: true, downtimes };
}
