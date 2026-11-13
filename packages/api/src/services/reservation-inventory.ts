import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { loadConsumableReservedQuantities } from "@louez/db";
import type { BlockingReservationStatus, Database, Transaction } from "@louez/db";
import {
  getBlockingReservationStatuses,
  buildReservationAvailabilityPredicate,
  buildReservationOverlapPredicate,
  buildUnitRentableDuringPredicate,
  findBusyUnitIds,
  productAccessories,
  productUnits,
  products,
  reservations,
} from "@louez/db";
import type { UnitAttributes } from "@louez/types";
import {
  DEFAULT_COMBINATION_KEY,
  calculatePeakReservedQuantities,
  canonicalizeAttributes,
  getDeterministicCombinationSortValue,
  isPooledCombinationKey,
  matchesSelectedAttributes,
} from "@louez/utils";

import type { CapacityShortfall, ReservationUnitConflict } from "../contracts/reservations";

import { loadExcludedUnitInfo, netOfExcludedUnits } from "./availability";
import {
  capacityVerdictMetadata,
  nextCapacityVerdictDate,
  turnoverBufferVerdictMetadata,
} from "./capacity-verdict";
import {
  allocateStock,
  combinationsServing,
  heldUnitsOwed,
  type StockCombination,
  type StockLineAllocation,
} from "./stock-allocation";
import type { PricingCatalog } from "./pricing-catalog";
import { validateRequiredAccessoryLines } from "./required-accessories";
import { failReservation, type ReservationFailure } from "./reservation-failure";

export interface ReserveInventoryLine {
  lineId?: string;
  productId: string;
  quantity: number;
  selectedAttributes?: UnitAttributes;
  combinationKey?: string | null;
  /**
   * Units already held by the line. A pooled line keeps counting on their
   * combinations rather than floating elsewhere, so a unit it holds is never
   * promised to another line of that combination.
   */
  assignedUnitIds?: string[];
  /**
   * Spread the line over combinations whatever its key says: for a booked
   * line re-checked on its own that may be served by any matching unit.
   * Checkout lines never set it, so they always resolve to one combination.
   */
  pooled?: boolean;
}

const isPooledLine = (
  line: ReserveInventoryLine,
  axes: LockedProduct["bookingAttributeAxes"] | undefined,
): boolean => line.pooled === true || isPooledCombinationKey(axes, line.combinationKey);

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

interface ReserveInventoryInput {
  tx: Transaction;
  excludeReservationId?: string;
  /** Booked lines being re-checked themselves, left out of the overlap. */
  excludeReservationItemIds?: string[];
  skipConsumableCheck?: boolean;
  /**
   * For lines not composed by this write: a booking the store typed, a
   * confirmation of the lines as they are, a single booked line re-checked on
   * its own. A cart a customer composes always checks them.
   */
  skipRequiredAccessoryCheck?: boolean;
  storeId: string;
  lockedProductsById: Map<string, LockedProduct>;
  lines: ReserveInventoryLine[];
  window: { start: Date; end: Date };
  turnoverBufferMinutes: number;
  blockingStatuses: BlockingReservationStatus[];
}

type InventoryReserved = { ok: true; inventory: ReservedInventory };

/**
 * Inside the reservation transaction, after `lockReservationProducts`:
 * re-check required accessories against the current links, recompute what is
 * reserved during the window (pending blocks unless the store says otherwise,
 * turnover buffer applied, consumables shared across lines) and give each
 * tracked line its units. Nothing is written; the caller inserts.
 *
 * The lines of a tracked product are allocated by the rule of
 * `allocateStock` (S1): another booking that left a size or a colour open is
 * counted on every combination that can serve it, not on the product alone.
 * A line with an exact combination, or a checkout line, is placed whole on
 * the first combination of the deterministic order that fits; a line with no
 * exact combination keeps its pooled key and is served by any matching unit.
 *
 * A line the stock cannot cover stops the check with
 * `errors.productNoLongerAvailable`. With `onShortfall: "collect"` it is
 * recorded instead, takes what is left, and the other lines are still checked:
 * the answer then lists every shortfall, in the order of the lines, for a
 * caller that may book over the stock, and each unit a line holds that the
 * other bookings need, decided apart from the allocation (`heldUnitsOwed`).
 */
export function reserveInventory(
  input: ReserveInventoryInput & { onShortfall: "collect" },
): Promise<
  | (InventoryReserved & {
      shortfalls: CapacityShortfall[];
      /** The position in `lines` of each shortfall, in the same order. */
      shortfallLineIndexes: number[];
      /**
       * The units held by the lines (`assignedUnitIds`) that the other
       * bookings need, in the order of the lines (`heldUnitsOwed`).
       */
      uncoveredHeldUnits: Array<{ lineIndex: number; unitId: string }>;
    })
  | ReservationFailure
>;
export function reserveInventory(
  input: ReserveInventoryInput & { onShortfall?: "fail" },
): Promise<InventoryReserved | ReservationFailure>;
export async function reserveInventory({
  tx,
  storeId,
  lockedProductsById,
  lines,
  window,
  turnoverBufferMinutes,
  blockingStatuses,
  excludeReservationId,
  excludeReservationItemIds,
  skipConsumableCheck = false,
  skipRequiredAccessoryCheck = false,
  onShortfall = "fail",
}: ReserveInventoryInput & { onShortfall?: "fail" | "collect" }): Promise<
  | (InventoryReserved & {
      shortfalls?: CapacityShortfall[];
      shortfallLineIndexes?: number[];
      uncoveredHeldUnits?: Array<{ lineIndex: number; unitId: string }>;
    })
  | ReservationFailure
> {
  const collect = onShortfall === "collect";
  const shortfallByLineIndex = new Map<number, CapacityShortfall>();
  const uncoveredHeldUnits: Array<{ lineIndex: number; unitId: string }> = [];
  const recordShortfall = (
    index: number,
    line: ReserveInventoryLine,
    product: LockedProduct,
    combinationKey: string | null,
    available: number,
  ) => {
    shortfallByLineIndex.set(index, {
      productId: product.id,
      productName: product.name,
      combinationKey,
      requested: line.quantity,
      available,
    });
  };
  const succeed = (inventory: ReservedInventory) => {
    if (!collect) return { ok: true as const, inventory };
    const byLine = [...shortfallByLineIndex.entries()].sort(([a], [b]) => a - b);
    return {
      ok: true as const,
      inventory,
      shortfalls: byLine.map(([, shortfall]) => shortfall),
      shortfallLineIndexes: byLine.map(([index]) => index),
      uncoveredHeldUnits: [...uncoveredHeldUnits].sort((a, b) => a.lineIndex - b.lineIndex),
    };
  };

  const requestedProductIds = [...new Set(lines.map((line) => line.productId))];
  if (requestedProductIds.length === 0) {
    return succeed({ lockedProductsById, resolvedCombinationByLineKey: new Map() });
  }
  const lockedProducts = [...lockedProductsById.values()];

  // Product links are mutable configuration. Re-read them only after the
  // parent product locks so checkout enforces the rule that is current at
  // the instant the reservation is written.
  const lockedRequiredAccessories = skipRequiredAccessoryCheck
    ? []
    : await tx
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
  const loadedReservations = await tx.query.reservations.findMany({
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
  const excludedItemIds = new Set(excludeReservationItemIds ?? []);
  const overlappingReservations =
    excludedItemIds.size === 0
      ? loadedReservations
      : loadedReservations.map((reservation) => ({
          ...reservation,
          items: reservation.items.filter((item) => !excludedItemIds.has(item.id)),
        }));

  const trackedProductIds = lockedProducts
    .filter((product) => product.trackUnits)
    .map((product) => product.id);
  const consumableProductIds = lockedProducts
    .filter((product) => product.stockKind === "consumable" && !skipConsumableCheck)
    .map((product) => product.id);

  const trackedUnits =
    trackedProductIds.length > 0
      ? await tx
          .select({ id: productUnits.id })
          .from(productUnits)
          .where(inArray(productUnits.productId, trackedProductIds))
      : [];
  const availableUnits =
    trackedProductIds.length > 0
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
              inArray(productUnits.productId, trackedProductIds),
              buildUnitRentableDuringPredicate(tx, window.start, window.end),
            ),
          )
      : [];
  const availableUnitIds = new Set(availableUnits.map((unit) => unit.id));
  const excludedProductUnitIds = new Set(
    trackedUnits.filter((unit) => !availableUnitIds.has(unit.id)).map((unit) => unit.id),
  );
  const excludedUnitInfo = await loadExcludedUnitInfo(tx, excludedProductUnitIds);
  const rentableUnitById = new Map(availableUnits.map((unit) => [unit.id, unit]));

  const netReservations = netOfExcludedUnits({
    reservations: overlappingReservations,
    excludedProductUnitIds,
    excludedUnitInfo,
    consumableProductIds: new Set(consumableProductIds),
    combinationKeyByUnitId: new Map(
      availableUnits.map((unit) => [unit.id, unit.combinationKey || DEFAULT_COMBINATION_KEY]),
    ),
  });
  // Products counted by quantity: the most the other bookings hold at once.
  const { reservedByProduct } = calculatePeakReservedQuantities({
    reservations: netReservations,
    startDate: window.start,
    endDate: window.end,
    turnoverBufferMinutes,
  });
  const consumableReservedByProduct = await loadConsumableReservedQuantities(tx, {
    storeId,
    productIds: consumableProductIds,
    blockingStatuses,
  });
  for (const [productId, reservedQuantity] of consumableReservedByProduct) {
    reservedByProduct.set(productId, reservedQuantity);
  }

  // Products whose units are tracked: all the lines of a product are placed
  // at once, next to what the other bookings ask of it at each instant.
  const trackedByLineIndex = new Map<
    number,
    { allocation: StockLineAllocation; pooled: boolean; selectedAttributes: UnitAttributes }
  >();
  const combinationsByProduct = new Map<string, Map<string, StockCombination>>();
  const bufferMs = Math.max(0, turnoverBufferMinutes) * 60_000;
  for (const product of lockedProducts) {
    if (!product.trackUnits) continue;
    const axes = product.bookingAttributeAxes || [];
    const productLines = lines.flatMap((line, index) =>
      line.productId === product.id
        ? [
            {
              line,
              index,
              pooled: isPooledLine(line, axes),
              // A booked line keeps the attributes chosen at the time; only
              // the product's current axes take part in matching, so a value
              // from an axis withdrawn since then no longer blocks that line.
              selectedAttributes: canonicalizeAttributes(axes, line.selectedAttributes),
              // The rentable units of the product the line holds: one that is
              // not rentable is the unit check's (S4), not the stock's. Each
              // is counted in its own combination's capacity below.
              heldUnits: (line.assignedUnitIds ?? []).flatMap((unitId) => {
                const unit = rentableUnitById.get(unitId);
                return unit?.productId === product.id
                  ? [{ unitId, combinationKey: unit.combinationKey || DEFAULT_COMBINATION_KEY }]
                  : [];
              }),
            },
          ]
        : [],
    );
    if (productLines.length === 0) continue;

    const capacity = new Map<string, number>();
    const combinationByKey = new Map<string, StockCombination>();
    for (const unit of availableUnits) {
      if (unit.productId !== product.id) continue;
      const combinationKey = unit.combinationKey || DEFAULT_COMBINATION_KEY;
      capacity.set(combinationKey, (capacity.get(combinationKey) ?? 0) + 1);
      // Same rule as availability: only the product's current axes are kept,
      // so a value left over from a removed axis never lands on the booking.
      const selectedAttributes = canonicalizeAttributes(axes, unit.attributes);
      const known = combinationByKey.get(combinationKey);
      if (!known || Object.keys(known.selectedAttributes).length === 0) {
        combinationByKey.set(combinationKey, { combinationKey, selectedAttributes });
      }
    }
    combinationsByProduct.set(product.id, combinationByKey);
    const sortValue = (combination: StockCombination) =>
      getDeterministicCombinationSortValue(axes, combination.selectedAttributes);
    const combinations = [...combinationByKey.values()].sort(
      (a, b) =>
        sortValue(a).localeCompare(sortValue(b), "en") ||
        a.combinationKey.localeCompare(b.combinationKey, "en"),
    );

    // The span each other booking holds its units, inside the window, both
    // widened by the turnover buffer as `calculatePeakReservedQuantities` does.
    const spans = netReservations.flatMap((reservation) => {
      const start = Math.max(reservation.startDate.getTime(), window.start.getTime());
      const end = Math.min(reservation.endDate.getTime(), window.end.getTime()) + bufferMs;
      return reservation.items.flatMap((item) =>
        item.productId === product.id
          ? [
              {
                start,
                end,
                demand: {
                  quantity: item.quantity,
                  combinationKeys: item.heldUnit
                    ? [item.combinationKey || DEFAULT_COMBINATION_KEY]
                    : combinationsServing(axes, combinations, item),
                },
              },
            ]
          : [],
      );
    });

    const allocations = allocateStock({
      capacity,
      bookings: spans,
      lines: productLines.map(({ line, pooled, selectedAttributes, heldUnits }) => ({
        quantity: line.quantity,
        candidates: combinations
          .filter(
            (combination) =>
              (!line.combinationKey ||
                pooled ||
                combination.combinationKey === line.combinationKey) &&
              matchesSelectedAttributes(selectedAttributes, combination.selectedAttributes),
          )
          .map((combination) => combination.combinationKey),
        // A checkout line books one combination; a pooled line is served by
        // any unit that matches what it chose, and keeps on their
        // combinations the units it already holds.
        single: !pooled,
        held: pooled ? heldUnits.map((unit) => unit.combinationKey) : [],
      })),
    });
    for (const [position, { index, pooled, selectedAttributes }] of productLines.entries()) {
      const allocation = allocations[position];
      if (allocation) trackedByLineIndex.set(index, { allocation, pooled, selectedAttributes });
    }

    if (collect) {
      // Whether a held unit is owed to the other bookings is decided apart
      // from the allocation, against them and the held units only: every unit
      // each line holds, whatever it asks for.
      const { owed } = heldUnitsOwed({
        capacity,
        bookings: spans,
        held: productLines.map(({ heldUnits }) => heldUnits.map((unit) => unit.combinationKey)),
      });
      // No held unit is `unplaceable` here: each is a rentable unit of this
      // product, counted in its own combination's capacity, and a unit is
      // held by one line of a reservation at most (one assignment per line,
      // and both writers that assign a unit refuse one a sibling line holds),
      // so a combination never has more held units than units.
      for (const { line, position } of owed) {
        const entry = productLines[line];
        const unitId = entry?.heldUnits[position]?.unitId;
        if (entry && unitId) uncoveredHeldUnits.push({ lineIndex: entry.index, unitId });
      }
    }
  }

  const resolvedCombinationByLineKey = new Map<string, ResolvedLineCombination>();

  for (const [index, line] of lines.entries()) {
    const product = lockedProductsById.get(line.productId);
    if (!product) return failReservation("errors.productNotFound");
    if (skipConsumableCheck && product.stockKind === "consumable") continue;

    if (!product.trackUnits) {
      if (product.stockKind === "untracked") {
        continue;
      }

      const reserved = reservedByProduct.get(line.productId) || 0;
      const available = Math.max(0, product.quantity - reserved);
      if (line.quantity > available) {
        if (!collect) {
          return failReservation("errors.productNoLongerAvailable", { name: product.name });
        }
        recordShortfall(index, line, product, null, available);
        reservedByProduct.set(line.productId, reserved + available);
        continue;
      }

      reservedByProduct.set(line.productId, reserved + line.quantity);
      continue;
    }

    const tracked = trackedByLineIndex.get(index);
    if (!tracked) continue;
    const { allocation, pooled, selectedAttributes } = tracked;
    if (allocation.served < line.quantity) {
      if (!collect) {
        return failReservation("errors.productNoLongerAvailable", { name: product.name });
      }
      recordShortfall(
        index,
        line,
        product,
        !pooled && line.combinationKey && line.combinationKey !== DEFAULT_COMBINATION_KEY
          ? line.combinationKey
          : null,
        allocation.served,
      );
    }

    const lineKey = getReservationLineKey(line, index);
    if (pooled) {
      // No single combination has to cover a pooled line: it keeps its pooled key.
      resolvedCombinationByLineKey.set(lineKey, {
        combinationKey: line.combinationKey ?? DEFAULT_COMBINATION_KEY,
        selectedAttributes,
      });
      continue;
    }
    const resolved =
      allocation.combinationKey === null
        ? undefined
        : combinationsByProduct.get(product.id)?.get(allocation.combinationKey);
    if (!resolved) continue;
    resolvedCombinationByLineKey.set(lineKey, {
      combinationKey: resolved.combinationKey,
      selectedAttributes: toResolvedAttributes(selectedAttributes, resolved.selectedAttributes),
    });
  }

  return succeed({ lockedProductsById, resolvedCombinationByLineKey });
}

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

/**
 * Units the reservation holds cannot serve it. Its message is the stock
 * refusal, which any caller may show: a customer never reads which units.
 * `conflicts` names them, for the store alone.
 */
export class ReservationUnitConflictError extends ReservationInventoryError {
  constructor(readonly conflicts: ReservationUnitConflict[]) {
    super("errors.productNoLongerAvailable");
  }
}

/**
 * The units a reservation holds, each checked by id over its window (S4):
 * `hard` when the unit is retired or in downtime, or held by another blocking
 * booking whose dates overlap; `buffer` when only the turnover buffer around
 * another booking reaches it. The units are locked, after the products and
 * the reservation.
 */
const findReservationUnitConflicts = async (
  tx: Transaction,
  params: {
    items: Array<{
      id: string;
      assignedUnits: Array<{ productUnitId: string | null; identifierSnapshot: string }>;
    }>;
    window: { start: Date; end: Date };
    blockingStatuses: BlockingReservationStatus[];
    turnoverBufferMinutes: number;
  },
): Promise<{
  hard: ReservationUnitConflict[];
  buffer: ReservationUnitConflict[];
  /** Each held unit's name, as the store reads it now. */
  identifiers: Map<string, string>;
}> => {
  const hard: ReservationUnitConflict[] = [];
  const buffer: ReservationUnitConflict[] = [];
  const identifiers = new Map<string, string>();
  // A unit deleted since keeps its name on the line and holds nothing.
  const heldByItem = params.items.map((item) => ({
    reservationItemId: item.id,
    units: item.assignedUnits.flatMap((unit) =>
      unit.productUnitId
        ? [{ unitId: unit.productUnitId, identifier: unit.identifierSnapshot }]
        : [],
    ),
  }));
  const unitIds = [...new Set(heldByItem.flatMap((item) => item.units.map((unit) => unit.unitId)))];
  if (unitIds.length === 0) return { hard, buffer, identifiers };

  const lockedUnits = await tx
    .select({ id: productUnits.id, identifier: productUnits.identifier })
    .from(productUnits)
    .where(inArray(productUnits.id, unitIds))
    .orderBy(productUnits.id)
    .for("update");
  const identifierById = new Map(lockedUnits.map((unit) => [unit.id, unit.identifier]));
  const rentableUnits = await tx
    .select({ id: productUnits.id })
    .from(productUnits)
    .where(
      and(
        inArray(productUnits.id, unitIds),
        buildUnitRentableDuringPredicate(tx, params.window.start, params.window.end),
      ),
    );
  const rentableUnitIds = new Set(rentableUnits.map((unit) => unit.id));

  for (const { reservationItemId, units } of heldByItem) {
    if (units.length === 0) continue;
    const busyUnitIds = await findBusyUnitIds(tx, {
      unitIds: units.map((unit) => unit.unitId),
      start: params.window.start,
      end: params.window.end,
      blockingStatuses: params.blockingStatuses,
      turnoverBufferMinutes: params.turnoverBufferMinutes,
      excludeReservationItemId: reservationItemId,
    });
    for (const unit of units) {
      const conflict = {
        reservationItemId,
        unitId: unit.unitId,
        identifier: identifierById.get(unit.unitId) || unit.identifier || unit.unitId,
      };
      identifiers.set(unit.unitId, conflict.identifier);
      const busy = busyUnitIds.get(unit.unitId);
      if (!rentableUnitIds.has(unit.unitId) || busy === "overlap") hard.push(conflict);
      else if (busy === "buffer") buffer.push(conflict);
    }
  }
  return { hard, buffer, identifiers };
};

/** The stock refusal of a confirmation, as any caller may show it. */
const STOCK_GONE = "errors.productNoLongerAvailable";

/**
 * The store's confirmation finds lines the returnable stock cannot cover,
 * counted without the turnover buffer: it may book over them on purpose
 * (`allowOverbooking`). The message is the stock refusal any caller shows.
 */
export class ReservationCapacityShortfallError extends ReservationInventoryError {
  constructor(readonly shortfalls: CapacityShortfall[]) {
    super(STOCK_GONE);
  }
}

/**
 * The store's confirmation finds lines that fit without the turnover buffer
 * and not with it, and was not sent with `overrideTurnoverBuffer`;
 * `allowOverbooking` does not cover them. Each shortfall is the check's with
 * the buffer.
 */
export class ReservationTurnoverBufferShortfallError extends ReservationInventoryError {
  constructor(readonly shortfalls: CapacityShortfall[]) {
    super(STOCK_GONE);
  }
}

/** What a confirmation's stock check gives its status change's activity row. */
export interface ConfirmationStockVerdict {
  activityMetadata: Record<string, unknown>;
  activityAt: Date;
}

/**
 * The stock check of a change into a status that takes stock, under the
 * product locks, before any refusal: the units the reservation holds, and
 * the shortfalls of its lines with the turnover buffer and without it. A
 * reservation that did not block yet (a quote, or a request when requests do
 * not block) may hold a unit that was since given to another booking: the
 * stock would still count enough units, so the units are checked by id.
 *
 * It confirms the lines as they are: required accessories are checked where
 * a cart is composed (the checkout, the extension), never here, so a quote
 * the store typed without one, or a request whose product gained one since,
 * is not refused for it.
 *
 * Throws `ReservationUnitConflictError` for a unit that cannot serve, before
 * any stock refusal: no caller may book over it (S4). That is a unit another
 * booking holds, or one retired or in downtime, and also a unit no other
 * booking holds but that the other bookings need, counted without the
 * turnover buffer: next to them and the units the reservation holds before
 * it, it does not fit, and with no other booking it would
 * (`heldUnitsOwed`, `reason: "owed_to_other_bookings"`). That is decided
 * apart from the allocation of the lines, so what the lines ask beyond their
 * units never makes a held unit owed. An override covers only the units a
 * line does not hold yet. A unit only the turnover buffer around another
 * booking reaches does not refuse: it is named for the activity row.
 */
async function checkConfirmationStock(tx: Transaction, reservationId: string, storeId: string) {
  const reservation = await tx.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)),
    with: {
      // The lines in a fixed order: the allocation places them in turn, so
      // the verdict is the same whichever order the rows are read in.
      items: {
        with: { assignedUnits: true },
        orderBy: (item, { asc }) => [asc(item.createdAt), asc(item.id)],
      },
      store: { columns: { settings: true } },
    },
  });
  if (!reservation) throw new ReservationInventoryError("errors.reservationNotFound");
  const lineItems = reservation.items.filter((item) => item.productId);
  const lines = lineItems.flatMap((item) =>
    item.productId
      ? [
          {
            productId: item.productId,
            quantity: item.quantity,
            selectedAttributes: item.selectedAttributes ?? undefined,
            combinationKey: item.combinationKey,
            assignedUnitIds: item.assignedUnits.flatMap((unit) =>
              unit.productUnitId ? [unit.productUnitId] : [],
            ),
            // A line booked with no exact combination is served by any unit
            // that matches what it chose, as when it was created or edited.
            pooled: item.combinationKey === null,
          },
        ]
      : [],
  );
  const lockedProductsById = await lockReservationProducts(
    tx,
    storeId,
    lines.map((line) => line.productId),
  );
  const window = { start: reservation.startDate, end: reservation.endDate };
  const turnoverBufferMinutes = reservation.store.settings?.turnoverBufferMinutes ?? 0;
  const blockingStatuses = getBlockingReservationStatuses(
    reservation.store.settings?.pendingBlocksAvailability ?? true,
  );
  const check = (bufferMinutes: number) =>
    reserveInventory({
      tx,
      storeId,
      lines,
      lockedProductsById,
      window,
      turnoverBufferMinutes: bufferMinutes,
      blockingStatuses,
      excludeReservationId: reservationId,
      skipConsumableCheck: true,
      // Every shortfall of the demand, for the verdict and the refusal.
      onShortfall: "collect",
      skipRequiredAccessoryCheck: true,
    });
  const buffered = await check(turnoverBufferMinutes);
  // The same demand without the buffer: what the stock itself lacks. Without
  // a buffer, the two checks are one.
  const unbuffered = turnoverBufferMinutes > 0 ? await check(0) : buffered;
  const unitConflicts = await findReservationUnitConflicts(tx, {
    items: reservation.items,
    window,
    blockingStatuses,
    turnoverBufferMinutes,
  });
  if (unitConflicts.hard.length > 0) {
    throw new ReservationUnitConflictError(unitConflicts.hard);
  }
  if (!buffered.ok || !unbuffered.ok) throw new ReservationInventoryError(STOCK_GONE);
  // A held unit the other bookings need, counted without the buffer: like a
  // unit another booking holds, no override books over it.
  if (unbuffered.uncoveredHeldUnits.length > 0) {
    throw new ReservationUnitConflictError(
      unbuffered.uncoveredHeldUnits.map(
        ({ lineIndex, unitId }): ReservationUnitConflict => ({
          reservationItemId: lineItems[lineIndex]?.id ?? "",
          unitId,
          identifier: unitConflicts.identifiers.get(unitId) ?? unitId,
          reason: "owed_to_other_bookings",
        }),
      ),
    );
  }

  // A line short without the buffer is a capacity shortfall; a line short
  // only with it, a buffer-only one. Both checks place the same lines in the
  // same order, so a line is known by its position.
  const shortWithoutBuffer = new Set(unbuffered.shortfallLineIndexes);
  // Each shortfall names its line and what the line chose: two lines of one
  // product, both open on a choice, are otherwise alike, and the preview's
  // token must not take one for the other.
  const ofLines = (
    shortfalls: CapacityShortfall[],
    lineIndexes: number[],
    keep: (lineIndex: number) => boolean = () => true,
  ): CapacityShortfall[] =>
    shortfalls.flatMap((shortfall, position) => {
      const lineIndex = lineIndexes[position] ?? -1;
      if (!keep(lineIndex)) return [];
      const item = lineItems[lineIndex];
      return [
        {
          ...shortfall,
          ...(item
            ? { reservationItemId: item.id, selectedAttributes: item.selectedAttributes ?? null }
            : {}),
        },
      ];
    });
  return {
    capacityShortfalls: ofLines(unbuffered.shortfalls, unbuffered.shortfallLineIndexes),
    bufferOnlyShortfalls: ofLines(
      buffered.shortfalls,
      buffered.shortfallLineIndexes,
      (lineIndex) => !shortWithoutBuffer.has(lineIndex),
    ),
    bufferOnlyUnitIds: [...new Set(unitConflicts.buffer.map((conflict) => conflict.unitId))],
    turnoverBufferMinutes,
  };
}

/**
 * The activity row's facts: the capacity verdict of the demand checked (the
 * shortfalls booked over, or none), the turnover-buffer verdict of a store
 * confirmation sent with `overrideTurnoverBuffer` (null for any other), the
 * units only the buffer reaches, and the row's date
 * (`nextCapacityVerdictDate`), so that verdict is the reservation's latest
 * (services/capacity-verdict.ts).
 */
async function confirmationVerdict(
  tx: Transaction,
  reservationId: string,
  bookedOver: readonly CapacityShortfall[],
  bufferOnlyUnitIds: readonly string[],
  bufferOverride: { shortfalls: readonly CapacityShortfall[]; minutes: number } | null = null,
): Promise<ConfirmationStockVerdict> {
  return {
    activityMetadata: {
      // What this check observed of the stock: `overbooked: false` says the
      // demand fits now, not that the store approved anything; `overbooked:
      // true` lists what the store chose to book over. The latest verdict
      // counts, so an overbooking flagged earlier leaves the inbox once a
      // confirmation finds that the stock fits.
      ...capacityVerdictMetadata(bookedOver),
      // The buffer the store confirmed past, on this change only: nothing
      // reads it back as an approval (D5).
      ...(bufferOverride
        ? turnoverBufferVerdictMetadata(bufferOverride.shortfalls, bufferOverride.minutes)
        : {}),
      ...(bufferOnlyUnitIds.length > 0
        ? // Confirmed with units the turnover buffer alone reaches: traceable.
          { turnoverBufferOnlyUnitIds: [...bufferOnlyUnitIds] }
        : {}),
    },
    activityAt: await nextCapacityVerdictDate(tx, reservationId),
  };
}

/**
 * The stock check of a confirmation nobody may book over: the customer's
 * quote acceptance and the paid confirmation. Any shortfall, counted with
 * the turnover buffer, refuses with the stock refusal, which names no unit
 * and no shortfall (D1, docs/domain/reservation-changes.md). It takes no
 * override, and none can be passed: the store's confirmation has its own
 * entry, `checkStoreConfirmationInventory`.
 */
export const checkExistingReservationInventory = async (
  tx: Transaction,
  reservationId: string,
  storeId: string,
): Promise<ConfirmationStockVerdict> => {
  const stock = await checkConfirmationStock(tx, reservationId, storeId);
  if (stock.capacityShortfalls.length > 0 || stock.bufferOnlyShortfalls.length > 0) {
    throw new ReservationInventoryError(STOCK_GONE);
  }
  return confirmationVerdict(tx, reservationId, [], stock.bufferOnlyUnitIds);
};

/**
 * The stock check of the store's confirmation (S3, S4), with two overrides
 * that neither covers the other's shortfalls. A unit conflict refuses before
 * either. Then a line short only with the turnover buffer refuses with
 * `ReservationTurnoverBufferShortfallError` unless the store confirms past
 * the buffer on purpose (`overrideTurnoverBuffer`); then a capacity
 * shortfall, counted without the buffer, refuses with
 * `ReservationCapacityShortfallError` unless the store books over it
 * (`allowOverbooking`). The verdict records what each flag passed, on this
 * change only (D5, docs/domain/reservation-changes.md).
 *
 * Only the store's status service calls it (`scripts/reservation-writes.test.mjs`, R7).
 */
export const checkStoreConfirmationInventory = async (
  tx: Transaction,
  reservationId: string,
  storeId: string,
  options: { allowOverbooking: boolean; overrideTurnoverBuffer: boolean },
): Promise<
  ConfirmationStockVerdict & {
    bookedOver: CapacityShortfall[];
    /** The buffer-only shortfalls confirmed past the buffer; empty without the flag. */
    pastBuffer: CapacityShortfall[];
    turnoverBufferMinutes: number;
  }
> => {
  const stock = await checkConfirmationStock(tx, reservationId, storeId);
  if (stock.bufferOnlyShortfalls.length > 0 && !options.overrideTurnoverBuffer) {
    throw new ReservationTurnoverBufferShortfallError(stock.bufferOnlyShortfalls);
  }
  if (stock.capacityShortfalls.length > 0 && !options.allowOverbooking) {
    throw new ReservationCapacityShortfallError(stock.capacityShortfalls);
  }
  return {
    ...(await confirmationVerdict(
      tx,
      reservationId,
      stock.capacityShortfalls,
      stock.bufferOnlyUnitIds,
      options.overrideTurnoverBuffer
        ? { shortfalls: stock.bufferOnlyShortfalls, minutes: stock.turnoverBufferMinutes }
        : null,
    )),
    bookedOver: stock.capacityShortfalls,
    pastBuffer: options.overrideTurnoverBuffer ? stock.bufferOnlyShortfalls : [],
    turnoverBufferMinutes: stock.turnoverBufferMinutes,
  };
};
