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

import type { ReservationUnitConflict } from "../contracts/reservations";

import { loadExcludedUnitInfo, netOfExcludedUnits } from "./availability";
import {
  allocateStock,
  combinationsServing,
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

/**
 * A line the stock cannot cover whole: how many units it asks for, and how
 * many of them are left next to the other bookings and the lines before it.
 */
export interface CapacityShortfall {
  productId: string;
  productName: string;
  /** The combination the line chose; null for a counted product or a line served by any unit. */
  combinationKey: string | null;
  requested: number;
  available: number;
}

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
  /** For a single booked line re-checked on its own, outside its reservation. */
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
 * caller that may book over the stock.
 */
export function reserveInventory(
  input: ReserveInventoryInput & { onShortfall: "collect" },
): Promise<(InventoryReserved & { shortfalls: CapacityShortfall[] }) | ReservationFailure>;
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
  (InventoryReserved & { shortfalls?: CapacityShortfall[] }) | ReservationFailure
> {
  const collect = onShortfall === "collect";
  const shortfallByLineIndex = new Map<number, CapacityShortfall>();
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
  const succeed = (inventory: ReservedInventory) =>
    collect
      ? {
          ok: true as const,
          inventory,
          shortfalls: [...shortfallByLineIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, shortfall]) => shortfall),
        }
      : { ok: true as const, inventory };

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
      lines: productLines.map(({ line, pooled, selectedAttributes }) => ({
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
        held: pooled
          ? (line.assignedUnitIds ?? []).flatMap((unitId) => {
              const unit = rentableUnitById.get(unitId);
              return unit?.productId === product.id
                ? [unit.combinationKey || DEFAULT_COMBINATION_KEY]
                : [];
            })
          : [],
      })),
    });
    for (const [position, { index, pooled, selectedAttributes }] of productLines.entries()) {
      const allocation = allocations[position];
      if (allocation) trackedByLineIndex.set(index, { allocation, pooled, selectedAttributes });
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
 * `key` and `conflicts` name them, for the store alone.
 */
export class ReservationUnitConflictError extends ReservationInventoryError {
  constructor(
    /** `errors.turnoverBufferConflict` when only the turnover buffer makes the conflict. */
    readonly key: "errors.assignedUnitsConflict" | "errors.turnoverBufferConflict",
    readonly conflicts: ReservationUnitConflict[],
  ) {
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
): Promise<{ hard: ReservationUnitConflict[]; buffer: ReservationUnitConflict[] }> => {
  const hard: ReservationUnitConflict[] = [];
  const buffer: ReservationUnitConflict[] = [];
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
  if (unitIds.length === 0) return { hard, buffer };

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
      const busy = busyUnitIds.get(unit.unitId);
      if (!rentableUnitIds.has(unit.unitId) || busy === "overlap") hard.push(conflict);
      else if (busy === "buffer") buffer.push(conflict);
    }
  }
  return { hard, buffer };
};

/**
 * Check an existing reservation before it takes its stock, under the same
 * product locks as a new checkout: the stock covers its lines, and each unit
 * it holds is free for it. A reservation that did not block yet (a quote, or
 * a request when requests do not block) may hold a unit that was since given
 * to another booking: the stock would still count enough units, so the units
 * are checked by id.
 *
 * Throws `ReservationUnitConflictError` for a unit that cannot serve, before
 * the stock refusal; a conflict the turnover buffer alone makes comes last,
 * and is refused too, as the change has no way to pass the buffer.
 */
export const checkExistingReservationInventory = async (
  tx: Transaction,
  reservationId: string,
  storeId: string,
) => {
  const reservation = await tx.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)),
    with: {
      items: { with: { assignedUnits: true } },
      store: { columns: { settings: true } },
    },
  });
  if (!reservation) throw new ReservationInventoryError("errors.reservationNotFound");
  const lines = reservation.items.flatMap((item) =>
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
  const result = await reserveInventory({
    tx,
    storeId,
    lines,
    lockedProductsById,
    window,
    turnoverBufferMinutes,
    blockingStatuses,
    excludeReservationId: reservationId,
    skipConsumableCheck: true,
  });
  const unitConflicts = await findReservationUnitConflicts(tx, {
    items: reservation.items,
    window,
    blockingStatuses,
    turnoverBufferMinutes,
  });
  if (unitConflicts.hard.length > 0) {
    throw new ReservationUnitConflictError("errors.assignedUnitsConflict", unitConflicts.hard);
  }
  if (!result.ok) throw new ReservationInventoryError("errors.productNoLongerAvailable");
  if (unitConflicts.buffer.length > 0) {
    throw new ReservationUnitConflictError("errors.turnoverBufferConflict", unitConflicts.buffer);
  }
};
