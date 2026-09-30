import { ORPCError } from "@orpc/server";
import { and, eq, exists, gte, inArray, ne, or } from "drizzle-orm";

import {
  db,
  getBlockingReservationStatuses,
  getEffectiveProductQuantities,
  products,
  reservationItems,
  reservations,
  stores,
} from "@louez/db";
import type { LegMethod, PricingKind, StockKind } from "@louez/types";
import type { SeasonalPricingConfig } from "@louez/utils";

const NON_EDITABLE_STATUSES = new Set(["completed", "cancelled", "rejected"]);
const AVAILABILITY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

interface RawTier {
  id: string;
  minDuration: number | null;
  discountPercent: string | null;
  period: number | null;
  price: string | null;
  displayOrder: number | null;
}

interface RawSeasonalPricing {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  price: string;
  tiers: RawTier[];
}

interface RawProduct {
  id: string;
  name: string;
  price: string;
  deposit: string | null;
  images: string[] | null;
  quantity: number;
  stockKind: StockKind;
  pricingKind: PricingKind;
  pricingMode: string | null;
  basePeriodMinutes: number | null;
  enforceStrictTiers: boolean;
  pricingTiers: RawTier[];
  seasonalPricings: RawSeasonalPricing[];
  tulipMapping?: { productId: string } | null;
}

function toLegMethod(value: string | null): LegMethod {
  return value === "address" ? "address" : "store";
}

/**
 * Tier-based fields (minDuration, discountPercent) and rate-based fields
 * (period, price) together, so the edit form prices every pricing mode.
 */
function mapPricingTiers(tiers: RawTier[]) {
  return tiers.map((tier, index) => ({
    id: tier.id,
    minDuration: tier.minDuration ?? 1,
    discountPercent: parseFloat(tier.discountPercent ?? "0"),
    period: tier.period ?? null,
    price: tier.price !== null ? parseFloat(tier.price) : null,
    displayOrder: tier.displayOrder ?? index,
  }));
}

function mapSeasonalPricings(seasonalPricings: RawSeasonalPricing[]): SeasonalPricingConfig[] {
  return seasonalPricings.map((sp) => ({
    id: sp.id,
    name: sp.name,
    startDate: sp.startDate,
    endDate: sp.endDate,
    basePrice: parseFloat(sp.price),
    tiers: sp.tiers
      .filter((t) => t.minDuration !== null)
      .map((t, i) => ({
        id: t.id,
        minDuration: t.minDuration ?? 1,
        discountPercent: parseFloat(t.discountPercent ?? "0"),
        displayOrder: t.displayOrder ?? i,
      })),
    rates: sp.tiers
      .filter(
        (t): t is RawTier & { period: number; price: string } =>
          typeof t.period === "number" && t.period > 0 && typeof t.price === "string",
      )
      .map((t, i) => ({
        id: t.id,
        period: t.period,
        price: parseFloat(t.price),
        displayOrder: t.displayOrder ?? i,
      })),
  }));
}

function mapProduct(p: RawProduct) {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    deposit: p.deposit ?? "0",
    images: p.images ?? [],
    quantity: p.quantity,
    stockKind: p.stockKind,
    pricingKind: p.pricingKind,
    pricingMode: p.pricingMode,
    basePeriodMinutes: p.basePeriodMinutes,
    enforceStrictTiers: p.enforceStrictTiers,
    tulipInsurable: Boolean(p.tulipMapping?.productId),
    pricingTiers: mapPricingTiers(p.pricingTiers),
    seasonalPricings: mapSeasonalPricings(p.seasonalPricings),
  };
}

/** Other reservations that can hold stock, for the form's availability warnings. */
async function getActiveReservations(
  storeId: string,
  excludeReservationId: string,
  pendingBlocksAvailability: boolean,
) {
  const lookbackStart = new Date(Date.now() - AVAILABILITY_LOOKBACK_MS);
  const blockingStatuses = getBlockingReservationStatuses(pendingBlocksAvailability);

  const activeReservations = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      ne(reservations.id, excludeReservationId),
      inArray(reservations.status, blockingStatuses),
      or(
        gte(reservations.endDate, lookbackStart),
        exists(
          db
            .select({ id: reservationItems.id })
            .from(reservationItems)
            .innerJoin(products, eq(reservationItems.productId, products.id))
            .where(
              and(
                eq(reservationItems.reservationId, reservations.id),
                eq(products.storeId, storeId),
                eq(products.stockKind, "consumable"),
              ),
            ),
        ),
      ),
    ),
    with: {
      items: {
        columns: { productId: true, quantity: true, consumedQuantity: true },
        with: { product: { columns: { stockKind: true } } },
      },
    },
    columns: { id: true, startDate: true, endDate: true, status: true },
  });

  return activeReservations.map((reservation) => ({
    ...reservation,
    items: reservation.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      consumedQuantity: item.consumedQuantity,
      stockKind: item.product?.stockKind ?? "returnable",
    })),
  }));
}

/**
 * Everything the reservation edit form needs that changes with the
 * reservation or the catalogue. Store-level configuration (currency, delivery,
 * insurance) is loaded by the page itself.
 */
export async function getDashboardReservationEditContext(params: {
  reservationId: string;
  storeId: string;
}) {
  const { reservationId, storeId } = params;

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)),
    with: {
      activity: {
        columns: { id: true, metadata: true },
        orderBy: (activity, { desc }) => [desc(activity.createdAt)],
      },
      customer: { columns: { firstName: true, lastName: true } },
      items: {
        with: {
          product: {
            with: {
              pricingTiers: true,
              seasonalPricings: { with: { tiers: true } },
              tulipMapping: { columns: { productId: true } },
            },
          },
        },
      },
    },
  });

  if (!reservation) {
    throw new ORPCError("NOT_FOUND", { message: "errors.reservationNotFound" });
  }

  if (NON_EDITABLE_STATUSES.has(reservation.status)) {
    return { editable: false as const };
  }

  const [availableProducts, existingReservations] = await Promise.all([
    db.query.products.findMany({
      where: and(eq(products.storeId, storeId), eq(products.status, "active")),
      with: {
        pricingTiers: true,
        seasonalPricings: { with: { tiers: true } },
        tulipMapping: { columns: { productId: true } },
      },
      // Storefront catalog order, with a predictable alphabetical fallback
      // for stores that never configured displayOrder
      orderBy: (products, { asc }) => [asc(products.displayOrder), asc(products.name)],
    }),
    db.query.stores
      .findFirst({ where: eq(stores.id, storeId), columns: { settings: true } })
      .then((store) =>
        getActiveReservations(
          storeId,
          reservationId,
          store?.settings?.pendingBlocksAvailability ?? true,
        ),
      ),
  ]);

  const effectiveQuantities = await getEffectiveProductQuantities(
    db,
    Array.from(
      new Set([
        ...availableProducts.map((product) => product.id),
        ...reservation.items.flatMap((item) => (item.product ? [item.product.id] : [])),
      ]),
    ),
  );
  const withEffectiveQuantity = <T extends { id: string; trackUnits: boolean; quantity: number }>(
    product: T,
  ): T => ({
    ...product,
    quantity: product.trackUnits ? (effectiveQuantities.get(product.id) ?? 0) : product.quantity,
  });

  return {
    editable: true as const,
    activity: reservation.activity,
    reservation: {
      id: reservation.id,
      number: reservation.number,
      status: reservation.status,
      updatedAt: reservation.updatedAt,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      subtotalAmount: reservation.subtotalAmount,
      depositAmount: reservation.depositAmount,
      totalAmount: reservation.totalAmount,
      deliveryFee: reservation.deliveryFee,
      discountAmount: reservation.discountAmount,
      tulipInsuranceOptIn: reservation.tulipInsuranceOptIn,
      tulipInsuranceAmount: reservation.tulipInsuranceAmount,
      delivery: {
        outboundMethod: toLegMethod(reservation.outboundMethod),
        returnMethod: toLegMethod(reservation.returnMethod),
        pickupLocationId: reservation.pickupLocationId,
        returnLocationId: reservation.returnLocationId,
        pickupLocationSnapshot: reservation.pickupLocationSnapshot,
        returnLocationSnapshot: reservation.returnLocationSnapshot,
        deliveryAddress: reservation.deliveryAddress,
        deliveryCity: reservation.deliveryCity,
        deliveryPostalCode: reservation.deliveryPostalCode,
        deliveryCountry: reservation.deliveryCountry,
        deliveryLatitude: reservation.deliveryLatitude,
        deliveryLongitude: reservation.deliveryLongitude,
        deliveryDistanceKm: reservation.deliveryDistanceKm,
        deliveryFee: reservation.deliveryFee,
        returnAddress: reservation.returnAddress,
        returnCity: reservation.returnCity,
        returnPostalCode: reservation.returnPostalCode,
        returnCountry: reservation.returnCountry,
        returnLatitude: reservation.returnLatitude,
        returnLongitude: reservation.returnLongitude,
        returnDistanceKm: reservation.returnDistanceKm,
      },
      items: reservation.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        consumedQuantity: item.consumedQuantity,
        unitPrice: item.unitPrice,
        depositPerUnit: item.depositPerUnit,
        totalPrice: item.totalPrice,
        isCustomItem: item.isCustomItem,
        pricingBreakdown: item.pricingBreakdown,
        productSnapshot: item.productSnapshot,
        product: item.product ? mapProduct(withEffectiveQuantity(item.product)) : null,
      })),
      customer: {
        firstName: reservation.customer.firstName,
        lastName: reservation.customer.lastName,
      },
    },
    availableProducts: availableProducts.map((product) =>
      mapProduct(withEffectiveQuantity(product)),
    ),
    existingReservations,
  };
}

export type DashboardReservationEditContext = Awaited<
  ReturnType<typeof getDashboardReservationEditContext>
>;
