import type { BusinessHours } from "@louez/types";
import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import {
  reservations,
  reservationItems,
  productUnits,
  getBlockingReservationStatuses,
  buildUnitRentableDuringPredicate,
  findBusyUnitIds,
  type Transaction,
} from "@louez/db";
import { loadPricingCatalog } from "@louez/api/services/pricing-catalog";
import { isWithinBusinessHours } from "@/lib/utils/business-hours";
import { validateRentalDuration } from "./validate-rental-window";
import { lockReservationProducts, reserveInventory } from "./reserve-inventory";
import { computeReservationTotals, getReservationItemTaxFields, priceCart } from "./price-cart";
import {
  getExtensionAttempt,
  type ExtensionAttempt,
  type ExtensionPreview,
  type ExtensionReason,
} from "./extension.types";

export class ExtensionError extends Error {}
export const money = (value: number | null): string | null =>
  value === null ? null : value.toFixed(2);
export const cents = (value: number | string) => Math.round(Number(value) * 100);

export const loadExtensionReservation = async (
  tx: Transaction,
  storeId: string,
  reservationId: string,
  customerId?: string,
) => {
  await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, storeId),
        customerId ? eq(reservations.customerId, customerId) : undefined,
      ),
    )
    .for("update");
  const reservation = await tx.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, storeId),
      customerId ? eq(reservations.customerId, customerId) : undefined,
    ),
    with: {
      store: true,
      customer: true,
      payments: true,
      activity: true,
      items: { orderBy: [reservationItems.id], with: { assignedUnits: true } },
    },
  });
  if (!reservation) throw new ExtensionError("notFound");
  return reservation;
};
export type ExtensionReservation = Awaited<ReturnType<typeof loadExtensionReservation>>;

export const extensionFingerprint = (reservation: ExtensionReservation) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        status: reservation.status,
        start: reservation.startDate,
        end: reservation.endDate,
        total: reservation.totalAmount,
        subtotal: reservation.subtotalAmount,
        deposit: reservation.depositAmount,
        tax: reservation.taxRate,
        discount: reservation.discountAmount,
        insurance: reservation.tulipContractId,
        insuranceOptIn: reservation.tulipInsuranceOptIn,
        returnMethod: reservation.returnMethod,
        returnLocationId: reservation.returnLocationId,
        items: reservation.items.map(
          ({
            id,
            productId,
            quantity,
            unitPrice,
            totalPrice,
            taxRate,
            combinationKey,
            selectedAttributes,
            assignedUnits,
          }) => ({
            id,
            productId,
            quantity,
            unitPrice,
            totalPrice,
            taxRate,
            combinationKey,
            selectedAttributes,
            units: assignedUnits.map((unit) => unit.productUnitId).sort(),
          }),
        ),
      }),
    )
    .digest("hex");

export const parseExtensionEnd = (value: string, timezone: string): Date => {
  const end = fromZonedTime(value, timezone);
  if (
    !Number.isFinite(end.getTime()) ||
    end.getTime() > 2147483647000 ||
    formatInTimeZone(end, timezone, "yyyy-MM-dd'T'HH:mm") !== value
  )
    throw new ExtensionError("invalidDate");
  return end;
};

export const extensionManualReason = (
  reservation: ExtensionReservation,
  end: Date,
  now = new Date(),
): ExtensionReason | null => {
  if (reservation.store.settings?.automaticExtensions === false) return "disabled";
  if (reservation.endDate <= now) return "overdue";
  if (
    reservation.tulipInsuranceOptIn ||
    reservation.tulipContractId ||
    Number(reservation.tulipInsuranceAmount) > 0
  )
    return "insurance";
  if (reservation.returnMethod === "address") return "delivery";
  if (reservation.returnLocationId) return "location";
  if (reservation.source === "marketplace") return "manualPrice";
  if (
    Number(reservation.discountAmount) > 0 ||
    reservation.promoCodeId ||
    reservation.items.some(
      (item) => item.isCustomItem || !item.productId || item.pricingBreakdown?.isManualOverride,
    )
  )
    return "manualPrice";
  const rentalPaid = reservation.payments
    .filter((p) => p.type === "rental" && p.status === "completed")
    .reduce((sum, p) => sum + cents(p.amount), 0);
  const rentalRefunded = reservation.payments
    .filter(
      (p) =>
        p.status === "completed" &&
        p.refundOfPaymentId &&
        reservation.payments.some(
          (original) => original.id === p.refundOfPaymentId && original.type === "rental",
        ),
    )
    .reduce((sum, p) => sum + Math.abs(cents(p.amount)), 0);
  if (rentalPaid - rentalRefunded < cents(reservation.totalAmount)) return "unpaid";
  if (
    Number(reservation.depositAmount) > 0 &&
    (["released", "captured", "failed"].includes(reservation.depositStatus ?? "") ||
      (reservation.depositStatus === "authorized" &&
        (!reservation.depositAuthorizationExpiresAt ||
          end >= reservation.depositAuthorizationExpiresAt)))
  )
    return "deposit";
  return null;
};

export const checkExtensionInventory = async (
  tx: Transaction,
  reservation: ExtensionReservation,
  end: Date,
) => {
  const ids = reservation.items.flatMap((item) => (item.productId ? [item.productId] : []));
  const lockedProductsById = await lockReservationProducts(tx, reservation.storeId, ids);
  const blockingStatuses = getBlockingReservationStatuses(
    reservation.store.settings?.pendingBlocksAvailability ?? true,
  );
  const turnoverBufferMinutes = reservation.store.settings?.turnoverBufferMinutes ?? 0;
  const stock = await reserveInventory({
    tx,
    storeId: reservation.storeId,
    lockedProductsById,
    lines: reservation.items.flatMap((item) =>
      item.productId
        ? [
            {
              lineId: item.id,
              productId: item.productId,
              quantity: item.quantity,
              selectedAttributes: item.selectedAttributes ?? undefined,
              combinationKey: item.combinationKey,
            },
          ]
        : [],
    ),
    window: { start: reservation.startDate, end },
    blockingStatuses,
    turnoverBufferMinutes,
    excludeReservationId: reservation.id,
    skipConsumableCheck: true,
  });
  if (!stock.ok) throw new ExtensionError("unavailable");
  for (const item of reservation.items) {
    const ids = item.assignedUnits.flatMap((unit) =>
      unit.productUnitId ? [unit.productUnitId] : [],
    );
    if (item.assignedUnits.some((unit) => !unit.productUnitId))
      throw new ExtensionError("unavailable");
    if (!ids.length) continue;
    await tx
      .select({ id: productUnits.id })
      .from(productUnits)
      .where(inArray(productUnits.id, ids))
      .orderBy(productUnits.id)
      .for("update");
    const rentable = await tx
      .select({ id: productUnits.id })
      .from(productUnits)
      .where(
        and(
          inArray(productUnits.id, ids),
          buildUnitRentableDuringPredicate(tx, reservation.startDate, end),
        ),
      );
    if (rentable.length !== ids.length) throw new ExtensionError("unavailable");
    const busy = await findBusyUnitIds(tx, {
      unitIds: ids,
      start: reservation.startDate,
      end,
      blockingStatuses,
      turnoverBufferMinutes,
      excludeReservationItemId: item.id,
    });
    if (busy.size) throw new ExtensionError("unavailable");
  }
};

export const isExtensionReturnOpen = (
  end: Date,
  businessHours: BusinessHours | undefined,
  timezone = "UTC",
) => {
  if (!businessHours?.enabled) return true;
  if (!isWithinBusinessHours(end, { ...businessHours, closurePeriods: [] }, timezone).valid)
    return false;
  return !(businessHours.closurePeriods ?? []).some((period) => {
    if (!period.startDate || !period.endDate) return false;
    const start = fromZonedTime(
      `${period.startDate.slice(0, 10)}T${period.startTime || "00:00"}`,
      timezone,
    );
    const finish = fromZonedTime(
      `${period.endDate.slice(0, 10)}T${period.endTime || "23:59:59.999"}`,
      timezone,
    );
    return end >= start && end <= finish;
  });
};

export const quoteExtension = async (
  tx: Transaction,
  reservation: ExtensionReservation,
  end: Date,
  ignoreAttemptId?: string,
): Promise<{ preview: ExtensionPreview; plan?: ExtensionAttempt["plan"] }> => {
  if (!["confirmed", "ongoing"].includes(reservation.status))
    throw new ExtensionError("invalidStatus");
  if (!(end > reservation.endDate) || !(end > new Date())) throw new ExtensionError("invalidDate");
  const pending = reservation.activity.some((row) => {
    if (row.id === ignoreAttemptId) return false;
    const attempt = getExtensionAttempt(row.metadata);
    return attempt?.status === "checkout" && attempt.expiresMs > Date.now();
  });
  if (pending) throw new ExtensionError("pending");
  const settings = reservation.store.settings;
  const maxDays = settings?.maxExtensionDays;
  const firstEnd = Math.min(
    reservation.endDate.getTime(),
    ...reservation.activity.flatMap((row) => {
      const attempt = getExtensionAttempt(row.metadata);
      return attempt?.status === "confirmed" ? [new Date(attempt.originalEndDate).getTime()] : [];
    }),
  );
  if (maxDays && end.getTime() - firstEnd > maxDays * 86400000) throw new ExtensionError("tooLong");
  if (!isExtensionReturnOpen(end, settings?.businessHours, settings?.timezone))
    throw new ExtensionError("closed");
  const duration = validateRentalDuration({
    window: { start: reservation.startDate, end },
    settings,
    hasDurationProduct: true,
  });
  if (!duration.ok) throw new ExtensionError("tooLong");
  const manualReason = extensionManualReason(reservation, end);
  if (manualReason) return { preview: { mode: "manual", reason: manualReason } };
  const productIds = reservation.items.flatMap((item) => (item.productId ? [item.productId] : []));
  await lockReservationProducts(tx, reservation.storeId, productIds);
  const catalog = await loadPricingCatalog(tx, { storeId: reservation.storeId, productIds });
  const price = (date: Date) =>
    priceCart({
      catalog,
      lines: reservation.items.flatMap((item) =>
        item.productId
          ? [
              {
                productId: item.productId,
                quantity: item.quantity,
                startDate: reservation.startDate.toISOString(),
                endDate: date.toISOString(),
              },
            ]
          : [],
      ),
    });
  const original = price(reservation.endDate);
  const extended = price(end);
  if (!original.ok || !extended.ok) return { preview: { mode: "manual", reason: "manualPrice" } };
  const totals = (cart: typeof original.cart) =>
    computeReservationTotals({
      lines: cart.lines,
      insuranceAmount: 0,
      discountAmount: 0,
      deliveryFee: Number(reservation.deliveryFee ?? 0),
      totalDeposit: Number(reservation.depositAmount),
      taxSettings: settings?.tax,
    });
  const originalTotals = totals(original.cart);
  if (
    original.cart.lines.some(
      (line, index) => cents(line.subtotal) !== cents(reservation.items[index].totalPrice),
    ) ||
    cents(originalTotals.total) !== cents(reservation.totalAmount)
  )
    return { preview: { mode: "manual", reason: "manualPrice" } };
  const next = totals(extended.cart);
  if (!Number.isFinite(next.total) || next.total > 99999999.99) throw new ExtensionError("tooLong");
  const supplement = (cents(next.total) - cents(reservation.totalAmount)) / 100;
  if (supplement < 0) return { preview: { mode: "manual", reason: "manualPrice" } };
  if (
    supplement > 0 &&
    (!reservation.store.stripeAccountId || !reservation.store.stripeChargesEnabled)
  )
    return { preview: { mode: "manual", reason: "unpaid" } };
  await checkExtensionInventory(tx, reservation, end);
  const plan: ExtensionAttempt["plan"] = {
    subtotalAmount: next.subtotal.toFixed(2),
    totalAmount: next.total.toFixed(2),
    subtotalExclTax: money(next.subtotalExclTax),
    taxAmount: money(next.taxAmount),
    taxRate: money(next.taxRate),
    items: extended.cart.lines.map((line, index) => {
      const tax = getReservationItemTaxFields(next, line, index);
      const product = catalog.get(line.productId);
      if (!product) throw new ExtensionError("unavailable");
      return {
        id: reservation.items[index].id,
        pricingBreakdown: {
          basePrice: product.price,
          effectivePrice: line.unitPrice,
          duration: line.duration,
          durationMinutes: (end.getTime() - reservation.startDate.getTime()) / 60000,
          pricingMode: product.pricingMode,
          pricingKind: product.pricingKind,
          discountPercent:
            line.originalSubtotal > 0 && line.savings > 0
              ? (line.savings / line.originalSubtotal) * 100
              : null,
          discountAmount: line.savings,
          tierApplied: null,
          taxRate: tax.taxRate,
          taxAmount: tax.taxAmount,
          subtotalExclTax: tax.totalExclTax,
          subtotalInclTax:
            tax.totalExclTax !== null && tax.taxAmount !== null
              ? tax.totalExclTax + tax.taxAmount
              : line.subtotal,
        },
        unitPrice: line.unitPrice.toFixed(2),
        totalPrice: line.subtotal.toFixed(2),
        taxRate: money(tax.taxRate),
        taxAmount: money(tax.taxAmount),
        priceExclTax: money(tax.priceExclTax),
        totalExclTax: money(tax.totalExclTax),
      };
    }),
  };
  return {
    preview: {
      mode: "automatic",
      supplement,
      total: next.total,
      currency: settings?.currency ?? "EUR",
      endDate: end.toISOString(),
    },
    plan,
  };
};
