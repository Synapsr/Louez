import type { ProductUnitActivityPage } from "@louez/api/services";
import type {
  ProductListItem,
  ProductStatusFilter,
} from "@/app/(dashboard)/dashboard/products/types";
import type {
  ProductInventoryDetail,
  ProductInventoryUnit,
  ProductReservationStatus,
  ProductRevenueStats,
} from "@/app/(dashboard)/dashboard/products/[id]/queries";
import type { ProductTimelineData } from "@/app/(dashboard)/dashboard/products/[id]/reservation-timeline-actions";
import type { ProductInfoSectionProps } from "@/app/(dashboard)/dashboard/products/[id]/components/product-info-section-view";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { addDays, startOfDay } from "@/components/dashboard/reservations-timeline/timeline-utils";
import type { Locale } from "@/i18n/config";
import { getDemoCategories, getDemoProducts, type DemoBooking } from "./fixtures";
import {
  createDemoPlanningEntries,
  createDemoReservationPages,
  getDemoToday,
} from "./reservations";
import { getDemoProductsText } from "./text.products";

export const getDemoProductList = (locale: Locale = "fr"): ProductListItem[] => {
  const categories = getDemoCategories(locale);
  return getDemoProducts(locale).map((product) => ({
    id: product.id,
    name: product.name,
    images: product.images,
    price: product.price,
    deposit: product.deposit ?? null,
    quantity: product.quantity ?? 0,
    stockKind: "returnable",
    status: "active",
    category: categories.find((category) => product.categoryIds.includes(category.id)) ?? null,
  }));
};

export const filterDemoProducts = (
  products: ProductListItem[],
  filters: { categoryIds: string[]; status: ProductStatusFilter; search: string },
): ProductListItem[] =>
  products.filter(
    (product) =>
      (filters.status === "all" || product.status === filters.status) &&
      (filters.categoryIds.length === 0 ||
        (product.category && filters.categoryIds.includes(product.category.id))) &&
      product.name.toLocaleLowerCase().includes(filters.search.trim().toLocaleLowerCase()),
  );

const overlapsDay = (start: Date, end: Date, otherStart: Date, otherEnd: Date) =>
  startOfDay(start) <= startOfDay(otherEnd) && startOfDay(end) >= startOfDay(otherStart);

/** One source of truth for the inventory, the per-unit timeline and the product's statistics. */
export const createDemoProductDetail = (
  period: RentalPeriodValue,
  booking: DemoBooking,
  locale: Locale = "fr",
  productId = "demo-city-bike",
) => {
  const products = getDemoProductList(locale);
  const product = products.find((product) => product.id === productId) ?? products[0];
  const today = getDemoToday(period);
  const pages = createDemoReservationPages(period, booking, locale, true);
  const rows = pages.rows.filter((row) =>
    row.items.some((item) => item.product?.id === product.id),
  );
  const units: ProductInventoryUnit[] = Array.from({ length: product.quantity }, (_, index) => ({
    id: `${product.id}-unit-${index + 1}`,
    identifier: `${product.id === "demo-city-bike" ? "VDV" : "VEL"}-${String(index + 1).padStart(2, "0")}`,
    attributes: null,
    lifecycleStatus: "active",
    retiredAt: null,
    retirementReason: null,
    notes: null,
    purchasePrice: null,
    purchasedAt: null,
    currentDowntime: null,
    isBusyToday: false,
    hasConflicts: false,
  }));
  const maintenanceUnit = units.at(-1);
  const timeline: ProductTimelineData = { reservations: [], downtimes: [] };
  if (maintenanceUnit) {
    const downtime = {
      id: `${product.id}-maintenance`,
      unitId: maintenanceUnit.id,
      reason: "maintenance",
      startsAt: startOfDay(addDays(today, -1)),
      endsAt: addDays(startOfDay(today), 3),
    } satisfies ProductTimelineData["downtimes"][number];
    timeline.downtimes.push(downtime);
    maintenanceUnit.currentDowntime = { ...downtime, note: null };
  }

  // Assign the existing demo reservations to free physical units, reserving the maintenance lane.
  // Day-based overlap matches the timeline's inclusive placement and availability calculation.
  const entries = createDemoPlanningEntries(pages.calendar)
    .filter((entry) => entry.productId === product.id)
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
  for (const entry of entries) {
    const availableUnits = units.filter(
      (unit) =>
        !timeline.downtimes.some(
          (downtime) =>
            downtime.unitId === unit.id &&
            overlapsDay(
              entry.startDate,
              entry.endDate,
              downtime.startsAt,
              downtime.endsAt ?? entry.endDate,
            ),
        ) &&
        !timeline.reservations.some(
          (reservation) =>
            reservation.assignedUnitIds.includes(unit.id) &&
            overlapsDay(entry.startDate, entry.endDate, reservation.startDate, reservation.endDate),
        ),
    );
    if (availableUnits.length < entry.quantity) {
      throw new Error(`Demo product stock exceeded for ${product.id}`);
    }
    timeline.reservations.push({
      ...entry,
      // Tooltip text remains real; demo customer/product links must not leave the scene.
      customerId: null,
      items: entry.items?.map((item) => ({ ...item, productId: null })),
      assignedUnitIds: availableUnits.slice(0, entry.quantity).map((unit) => unit.id),
    });
  }
  for (const unit of units) {
    unit.isBusyToday = timeline.reservations.some(
      (reservation) =>
        ["pending", "confirmed", "ongoing"].includes(reservation.status ?? "") &&
        reservation.assignedUnitIds.includes(unit.id) &&
        overlapsDay(today, today, reservation.startDate, reservation.endDate),
    );
  }
  const counts: Record<ProductReservationStatus, number> = {
    pending: 0,
    confirmed: 0,
    ongoing: 0,
    completed: 0,
    cancelled: 0,
    rejected: 0,
    quote: 0,
    declined: 0,
  };
  const revenueStats: ProductRevenueStats = {
    allTimeRevenue: 0,
    last30DaysRevenue: 0,
    previous30DaysRevenue: 0,
    revenueGrowth: 0,
    reservationCount: rows.length,
  };
  for (const row of rows) {
    if (row.status) counts[row.status]++;
    const index = pages.rows.findIndex((candidate) => candidate.id === row.id);
    const rowBooking = pages.bookings[index];
    const lines = rowBooking.lines ?? [rowBooking];
    const productAmount = lines.reduce(
      (sum, line) =>
        sum + (products[line.productIndex]?.id === product.id ? line.unitPrice * line.quantity : 0),
      0,
    );
    const subtotal = Number(row.subtotalAmount);
    const paid = row.payments.reduce(
      (sum, payment) =>
        sum +
        (payment.type === "rental" && payment.status === "completed" ? Number(payment.amount) : 0),
      0,
    );
    revenueStats.allTimeRevenue += subtotal > 0 ? (paid * productAmount) / subtotal : 0;
  }
  // The supplied fixtures all fall within the current month; previous-month revenue is zero.
  revenueStats.last30DaysRevenue = revenueStats.allTimeRevenue;
  const busyDays = timeline.reservations.reduce((sum, reservation) => {
    if (!["pending", "confirmed", "ongoing"].includes(reservation.status ?? "")) return sum;
    const start = Math.max(addDays(today, -30).getTime(), reservation.startDate.getTime());
    const end = Math.min(today.getTime(), reservation.endDate.getTime());
    return sum + (Math.max(0, end - start) / 86_400_000) * reservation.quantity;
  }, 0);
  const totalCapacityDays = product.quantity * 30;
  const inventoryDetail: ProductInventoryDetail = { mode: "tracked", units };
  const infoProduct: ProductInfoSectionProps["product"] = {
    description: product.id === "demo-city-bike" ? getDemoProductsText(locale).description : null,
    price: product.price,
    pricingKind: "duration",
    pricingMode: "day",
    basePeriodMinutes: 1440,
    images: product.images,
    pricingTiers: [],
    seasonalPricings: [],
    accessories: [],
  };
  const activity: ProductUnitActivityPage = {
    nextCursor: null,
    items: timeline.downtimes
      .map((downtime) => ({
        id: `${downtime.id}-event`,
        productUnitId: downtime.unitId,
        identifierSnapshot: units.find((unit) => unit.id === downtime.unitId)?.identifier ?? null,
        type: "downtime_declared",
        actorUserId: null,
        payload: null,
        createdAt: downtime.startsAt.toISOString(),
      }))
      .concat(
        units.slice(0, 4).map((unit) => ({
          id: `${unit.id}-created`,
          productUnitId: unit.id,
          identifierSnapshot: unit.identifier,
          type: "created",
          actorUserId: null,
          payload: null,
          createdAt: addDays(today, -90).toISOString(),
        })),
      ),
  };
  return {
    product,
    activity,
    today,
    timeline,
    units,
    inventoryDetail,
    counts,
    revenueStats,
    infoProduct,
    pages,
    reservationsPage: { items: rows, total: rows.length },
    utilization: {
      busyDays,
      totalCapacityDays,
      rate: totalCapacityDays > 0 ? busyDays / totalCapacityDays : 0,
    },
    quickFacts: {
      createdAt: addDays(today, -90),
      updatedAt: today,
      deposit: product.deposit ?? null,
      taxSettings: null,
      bookingAttributeAxes: null,
    },
  };
};
