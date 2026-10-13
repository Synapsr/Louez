import { and, eq, inArray, ne, sql } from "drizzle-orm";

import {
  computeReservedNetOfExcludedUnits,
  loadExcludedUnitInfo,
  validateRequiredAccessoryLines,
} from "@louez/api/services";
import { loadConsumableReservedQuantities } from "@louez/db";
import type { BlockingReservationStatus, Database, Transaction } from "@louez/db";
import {
  getBlockingReservationStatuses,
  buildReservationAvailabilityPredicate,
  buildReservationOverlapPredicate,
  buildUnitRentableDuringPredicate,
  productAccessories,
  productUnits,
  products,
  reservations,
} from "@louez/db";
import type { PricingCatalog } from "@louez/api/services/pricing-catalog";
import type { UnitAttributes } from "@louez/types";
import {
  DEFAULT_COMBINATION_KEY,
  getDeterministicCombinationSortValue,
  getProductCombinationAvailabilityKey,
  matchesSelectedAttributes,
} from "@louez/utils";

import { failReservation, type ReservationFailure } from "./reservation.types";
import type { RentalWindow } from "./validate-rental-window";

export interface ReserveInventoryLine {
  lineId?: string;
  productId: string;
  quantity: number;
  startDate?: string;
  endDate?: string;
  selectedAttributes?: UnitAttributes;
  combinationKey?: string | null;
}

export interface ResolvedLineCombination {
  combinationKey: string;
  selectedAttributes: UnitAttributes;
}

type LockedProduct = typeof products.$inferSelect;

export interface ReservedInventory {
  lockedProductsById: Map<string, LockedProduct>;
  /** Resolved unit combination per line key (tracked products only). */
  resolvedCombinationByLineKey: Map<string, ResolvedLineCombination>;
}

/** A line is addressed by its cart line id, or by product + position. */
export const getReservationLineKey = (
  line: { lineId?: string; productId: string },
  index: number,
): string => line.lineId || `${line.productId}:${index}`;

const toResolvedAttributes = (
  selected: UnitAttributes | undefined,
  resolved: UnitAttributes,
): UnitAttributes => ({ ...selected, ...resolved });

/**
 * First step of the reservation transaction: take row locks on the cart's
 * products so competing checkouts for the same products are serialized, and
 * read them back as they are at that instant.
 */
export const lockReservationProducts = async (
  tx: Transaction,
  storeId: string,
  productIds: string[],
): Promise<Map<string, LockedProduct>> => {
  const requestedProductIds = [...new Set(productIds)];
  if (requestedProductIds.length === 0) {
    return new Map();
  }

  const requestedProductIdSql = sql.join(
    requestedProductIds.map((productId) => sql`${productId}`),
    sql`, `,
  );
  await tx.execute(
    sql`SELECT id FROM ${products} WHERE id IN (${requestedProductIdSql}) AND store_id = ${storeId} FOR UPDATE`,
  );

  const lockedProducts = await tx.query.products.findMany({
    where: and(eq(products.storeId, storeId), inArray(products.id, requestedProductIds)),
  });
  return new Map(lockedProducts.map((product) => [product.id, product]));
};

/**
 * Inside the reservation transaction, after `lockReservationProducts`:
 * re-check required accessories against the current links, recompute what is
 * reserved during the window (pending blocks unless the store says otherwise,
 * turnover buffer applied, consumables shared across lines) and allocate each
 * tracked line to a deterministic unit combination. Nothing is written; the
 * caller inserts.
 */
export const reserveInventory = async ({
  tx,
  storeId,
  lockedProductsById,
  lines,
  window,
  turnoverBufferMinutes,
  blockingStatuses,
  excludeReservationId,
  skipConsumableCheck = false,
}: {
  tx: Transaction;
  excludeReservationId?: string;
  skipConsumableCheck?: boolean;
  storeId: string;
  lockedProductsById: Map<string, LockedProduct>;
  lines: ReserveInventoryLine[];
  window: RentalWindow;
  turnoverBufferMinutes: number;
  blockingStatuses: BlockingReservationStatus[];
}): Promise<{ ok: true; inventory: ReservedInventory } | ReservationFailure> => {
  const requestedProductIds = [...new Set(lines.map((line) => line.productId))];
  if (requestedProductIds.length === 0) {
    return {
      ok: true,
      inventory: { lockedProductsById, resolvedCombinationByLineKey: new Map() },
    };
  }
  const lockedProducts = [...lockedProductsById.values()];

  // Product links are mutable configuration. Re-read them only after the
  // parent product locks so checkout enforces the rule that is current at
  // the instant the reservation is written.
  const lockedRequiredAccessories = await tx
    .select({
      parentProductId: productAccessories.productId,
      accessoryProductId: productAccessories.accessoryId,
      quantity: productAccessories.quantity,
    })
    .from(productAccessories)
    .where(
      and(
        eq(productAccessories.required, true),
        inArray(productAccessories.productId, requestedProductIds),
      ),
    );
  const requiredAccessoryValidation = validateRequiredAccessoryLines({
    lines,
    requiredAccessories: lockedRequiredAccessories,
  });
  if (!requiredAccessoryValidation.valid) {
    return failReservation("errors.requiredAccessoriesMissing", undefined, {
      code: "required_accessories_missing",
      missingAccessories: requiredAccessoryValidation.missing,
    });
  }

  // Recompute overlap and availability inside the transaction after row locks are acquired.
  const overlappingReservations = await tx.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      excludeReservationId ? ne(reservations.id, excludeReservationId) : undefined,
      inArray(reservations.status, blockingStatuses),
      buildReservationAvailabilityPredicate(tx),
      buildReservationOverlapPredicate({
        start: window.start,
        end: window.end,
        turnoverBufferMinutes,
      }),
    ),
    with: { activity: { columns: { metadata: true } }, items: { with: { assignedUnits: true } } },
  });

  const consumableProductIds = lockedProducts
    .filter((product) => product.stockKind === "consumable" && !skipConsumableCheck)
    .map((product) => product.id);

  const consumableReservedByProduct = await loadConsumableReservedQuantities(tx, {
    storeId,
    productIds: consumableProductIds,
    blockingStatuses,
  });
  const resolvedCombinationByLineKey = new Map<string, ResolvedLineCombination>();
  const stagedLines: ReserveInventoryLine[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const product = lockedProductsById.get(line.productId);
    if (!product) return failReservation("errors.productNotFound");
    if (skipConsumableCheck && product.stockKind === "consumable") continue;

    const lineWindow = {
      start: line.startDate ? new Date(line.startDate) : window.start,
      end: line.endDate ? new Date(line.endDate) : window.end,
    };
    const availableUnits = product.trackUnits
      ? await tx
          .select({
            id: productUnits.id,
            productId: productUnits.productId,
            combinationKey: productUnits.combinationKey,
            attributes: productUnits.attributes,
          })
          .from(productUnits)
          .where(
            and(
              eq(productUnits.productId, product.id),
              buildUnitRentableDuringPredicate(tx, lineWindow.start, lineWindow.end),
            ),
          )
      : [];
    const allTrackedUnits = product.trackUnits
      ? await tx
          .select({ id: productUnits.id })
          .from(productUnits)
          .where(eq(productUnits.productId, product.id))
      : [];
    const availableUnitIds = new Set(availableUnits.map((unit) => unit.id));
    const excludedProductUnitIds = new Set(
      allTrackedUnits.filter((unit) => !availableUnitIds.has(unit.id)).map((unit) => unit.id),
    );
    const excludedUnitInfo = await loadExcludedUnitInfo(tx, excludedProductUnitIds);
    const stagedReservations = stagedLines.map((stagedLine) => {
      const startDate = stagedLine.startDate ? new Date(stagedLine.startDate) : window.start;
      const endDate = stagedLine.endDate ? new Date(stagedLine.endDate) : window.end;
      return {
        status: "ongoing",
        startDate,
        endDate,
        items: [
          {
            productId: stagedLine.productId,
            combinationKey: stagedLine.combinationKey,
            quantity: stagedLine.quantity,
            startDate,
            endDate,
            stockKind: lockedProductsById.get(stagedLine.productId)?.stockKind ?? "returnable",
            consumedQuantity: 0,
            assignedUnits: [],
          },
        ],
      };
    });
    const { reservedByProduct, reservedByProductCombination } = computeReservedNetOfExcludedUnits({
      reservations: [...overlappingReservations, ...stagedReservations],
      startDate: lineWindow.start,
      endDate: lineWindow.end,
      turnoverBufferMinutes,
      excludedProductUnitIds,
      excludedUnitInfo,
      consumableProductIds: new Set(consumableProductIds),
    });
    for (const [productId, quantity] of consumableReservedByProduct) {
      reservedByProduct.set(productId, quantity);
    }
    for (const stagedLine of stagedLines) {
      if (lockedProductsById.get(stagedLine.productId)?.stockKind !== "consumable") continue;
      reservedByProduct.set(
        stagedLine.productId,
        (reservedByProduct.get(stagedLine.productId) ?? 0) + stagedLine.quantity,
      );
    }

    const combinationsByProduct = new Map<
      string,
      Map<string, { totalQuantity: number; selectedAttributes: UnitAttributes }>
    >();
    for (const unit of availableUnits) {
      const productCombinations = combinationsByProduct.get(unit.productId) || new Map();
      const combinationKey = unit.combinationKey || DEFAULT_COMBINATION_KEY;
      const current = productCombinations.get(combinationKey);
      if (!current) {
        productCombinations.set(combinationKey, {
          totalQuantity: 1,
          selectedAttributes: unit.attributes || {},
        });
      } else {
        current.totalQuantity += 1;
        if (Object.keys(current.selectedAttributes).length === 0 && unit.attributes) {
          current.selectedAttributes = unit.attributes;
        }
      }
      combinationsByProduct.set(unit.productId, productCombinations);
    }

    if (!product.trackUnits) {
      if (product.stockKind === "untracked") {
        stagedLines.push({
          ...line,
          startDate: lineWindow.start.toISOString(),
          endDate: lineWindow.end.toISOString(),
        });
        continue;
      }

      const reserved = reservedByProduct.get(line.productId) || 0;
      const available = Math.max(0, product.quantity - reserved);
      if (line.quantity > available) {
        return failReservation("errors.productNoLongerAvailable", { name: product.name });
      }

      stagedLines.push({
        ...line,
        startDate: lineWindow.start.toISOString(),
        endDate: lineWindow.end.toISOString(),
      });
      continue;
    }

    const axes = product.bookingAttributeAxes || [];
    const productCombinations = combinationsByProduct.get(product.id) || new Map();
    const selectedAttributes = line.selectedAttributes || {};

    const candidates = [...productCombinations.entries()]
      .map(([combinationKey, combinationData]) => ({ combinationKey, ...combinationData }))
      .filter(
        (combination) =>
          (!line.combinationKey || combination.combinationKey === line.combinationKey) &&
          matchesSelectedAttributes(selectedAttributes, combination.selectedAttributes),
      )
      .sort((a, b) => {
        const sortA = getDeterministicCombinationSortValue(axes, a.selectedAttributes);
        const sortB = getDeterministicCombinationSortValue(axes, b.selectedAttributes);
        return sortA.localeCompare(sortB, "en");
      });

    const resolvedCombination = candidates.find((candidate) => {
      const key = getProductCombinationAvailabilityKey(product.id, candidate.combinationKey);
      const reserved = reservedByProductCombination.get(key) || 0;
      return Math.max(0, candidate.totalQuantity - reserved) >= line.quantity;
    });

    if (!resolvedCombination) {
      return failReservation("errors.productNoLongerAvailable", { name: product.name });
    }

    const key = getProductCombinationAvailabilityKey(
      product.id,
      resolvedCombination.combinationKey,
    );
    reservedByProductCombination.set(
      key,
      (reservedByProductCombination.get(key) || 0) + line.quantity,
    );
    resolvedCombinationByLineKey.set(getReservationLineKey(line, index), {
      combinationKey: resolvedCombination.combinationKey,
      selectedAttributes: toResolvedAttributes(
        selectedAttributes,
        resolvedCombination.selectedAttributes,
      ),
    });
    stagedLines.push({
      ...line,
      combinationKey: resolvedCombination.combinationKey,
      startDate: lineWindow.start.toISOString(),
      endDate: lineWindow.end.toISOString(),
    });
  }

  return { ok: true, inventory: { lockedProductsById, resolvedCombinationByLineKey } };
};

/**
 * Pre-transaction stock check per line, on the catalog snapshot: tracked
 * products need enough rentable units during the line's own period, counted
 * products need enough quantity, untracked products are unlimited. The
 * authoritative check runs again under lock in `reserveInventory`.
 */
export const preflightStock = async (
  database: Pick<Database, "select">,
  catalog: PricingCatalog,
  lines: Array<{ productId: string; quantity: number; startDate: string; endDate: string }>,
): Promise<{ ok: true } | ReservationFailure> => {
  for (const line of lines) {
    const product = catalog.get(line.productId);
    if (!product) {
      return failReservation("errors.productNotFound");
    }

    if (product.trackUnits) {
      const availableUnits = await database
        .select({ id: productUnits.id })
        .from(productUnits)
        .where(
          and(
            eq(productUnits.productId, product.id),
            buildUnitRentableDuringPredicate(
              database,
              new Date(line.startDate),
              new Date(line.endDate),
            ),
          ),
        );
      if (availableUnits.length < line.quantity) {
        return failReservation("errors.insufficientStock", {
          name: product.name,
          count: availableUnits.length,
        });
      }
    } else if (product.stockKind !== "untracked" && product.quantity < line.quantity) {
      return failReservation("errors.insufficientStock", {
        name: product.name,
        count: product.quantity,
      });
    }
  }

  return { ok: true };
};

export class ReservationInventoryError extends Error {}

/** Check an existing draft under the same product locks as a new checkout. */
export const checkExistingReservationInventory = async (
  tx: Transaction,
  reservationId: string,
  storeId: string,
) => {
  const reservation = await tx.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)),
    with: { items: true, store: { columns: { settings: true } } },
  });
  if (!reservation) throw new ReservationInventoryError("errors.reservationNotFound");
  const lines = reservation.items.flatMap((item) =>
    item.productId
      ? [
          {
            productId: item.productId,
            quantity: item.quantity,
            startDate: item.startDate?.toISOString(),
            endDate: item.endDate?.toISOString(),
            selectedAttributes: item.selectedAttributes ?? undefined,
            combinationKey: item.combinationKey,
          },
        ]
      : [],
  );
  const lockedProductsById = await lockReservationProducts(
    tx,
    storeId,
    lines.map((line) => line.productId),
  );
  const result = await reserveInventory({
    tx,
    storeId,
    lines,
    lockedProductsById,
    window: { start: reservation.startDate, end: reservation.endDate },
    turnoverBufferMinutes: reservation.store.settings?.turnoverBufferMinutes ?? 0,
    blockingStatuses: getBlockingReservationStatuses(
      reservation.store.settings?.pendingBlocksAvailability ?? true,
    ),
    excludeReservationId: reservationId,
    skipConsumableCheck: true,
  });
  if (!result.ok) throw new ReservationInventoryError("errors.productNoLongerAvailable");
};
