import type { BookingAttributeAxis, UnitAttributes } from '@louez/types'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'

import type { Database, Transaction } from './index'
import {
  assertReservationLock,
  type ReservationProductsLock,
  type ReservationStockLock,
} from './reservation-lock'
import { products, reservationItemUnits, reservationItems, reservations } from './schema'
import { excludeTestReservations, isTestReservation } from './test-reservations'
import {
  buildReservationAvailabilityPredicate,
  type BlockingReservationStatus,
} from './unit-availability'

export interface ConsumableStockItem {
  itemId: string
  productId: string
  quantity: number
  consumedQuantity: number
}

export type ConsumableStockMutationMode = 'consume' | 'restore' | 'reconcile'

export interface ConsumableStockMutationPlan {
  itemChanges: Array<{ itemId: string; consumedQuantity: number }>
  productChanges: Array<{ productId: string; quantityDelta: number }>
}

export interface StockKindChangeBlocker {
  id: string
  number: string
}

type ReservationStatus = typeof reservations.$inferSelect.status

const stockConsumingReservationStatuses: ReservationStatus[] = ['confirmed', 'ongoing']

const reservationStatusTransitions: Partial<
  Record<ReservationStatus, readonly ReservationStatus[]>
> = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  quote: ['confirmed', 'declined', 'cancelled'],
  confirmed: ['ongoing', 'cancelled'],
  ongoing: ['completed', 'cancelled'],
}

export function getAllowedReservationStatusTransitions(
  status: ReservationStatus,
): readonly ReservationStatus[] {
  return reservationStatusTransitions[status] ?? []
}

export function canTransitionReservationStatus(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return getAllowedReservationStatusTransitions(from).includes(to)
}

export function reservationStatusConsumesStock(status: ReservationStatus): boolean {
  return stockConsumingReservationStatuses.includes(status)
}

export function canChangeProductStockKind(statuses: ReservationStatus[]): boolean {
  return statuses.every((status) => !reservationStatusConsumesStock(status))
}

export async function getProductStockKindChangeBlockers(
  database: Database,
  params: { productId: string; storeId: string },
): Promise<StockKindChangeBlocker[]> {
  return database
    .selectDistinct({ id: reservations.id, number: reservations.number })
    .from(reservations)
    .innerJoin(reservationItems, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(
        eq(reservations.storeId, params.storeId),
        eq(reservationItems.productId, params.productId),
        inArray(reservations.status, stockConsumingReservationStatuses),
        // A test reservation consumes nothing: it never blocks the change.
        excludeTestReservations(),
      ),
    )
    .orderBy(reservations.number)
}

export async function lockProductReservationsForStockKindChange(
  tx: Transaction,
  params: { productId: string; storeId: string },
): Promise<boolean> {
  const linkedReservations = await tx
    .select({ status: reservations.status })
    .from(reservations)
    .innerJoin(reservationItems, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(
        eq(reservations.storeId, params.storeId),
        eq(reservationItems.productId, params.productId),
        // A test reservation consumes nothing: it never blocks the change.
        excludeTestReservations(),
      ),
    )
    .orderBy(reservations.id)
    .for('update')

  return canChangeProductStockKind(linkedReservations.map(({ status }) => status))
}

export class ConsumableStockError extends Error {
  readonly code: 'INSUFFICIENT_STOCK' | 'PRODUCT_NOT_FOUND' | 'RESERVATION_NOT_FOUND'
  readonly productId: string | null
  readonly requestedQuantity: number | null
  readonly availableQuantity: number | null

  constructor(params: {
    code: 'INSUFFICIENT_STOCK' | 'PRODUCT_NOT_FOUND' | 'RESERVATION_NOT_FOUND'
    message: string
    productId?: string
    requestedQuantity?: number
    availableQuantity?: number
  }) {
    super(params.message)
    this.name = 'ConsumableStockError'
    this.code = params.code
    this.productId = params.productId ?? null
    this.requestedQuantity = params.requestedQuantity ?? null
    this.availableQuantity = params.availableQuantity ?? null
  }
}

export function planConsumableStockMutation(
  items: ConsumableStockItem[],
  mode: ConsumableStockMutationMode,
): ConsumableStockMutationPlan {
  const itemChanges: ConsumableStockMutationPlan['itemChanges'] = []
  const productQuantityDeltas = new Map<string, number>()

  for (const item of items) {
    const nextConsumedQuantity =
      mode === 'restore'
        ? 0
        : mode === 'consume'
          ? Math.max(item.consumedQuantity, item.quantity)
          : item.quantity

    if (nextConsumedQuantity === item.consumedQuantity) {
      continue
    }

    itemChanges.push({
      itemId: item.itemId,
      consumedQuantity: nextConsumedQuantity,
    })
    productQuantityDeltas.set(
      item.productId,
      (productQuantityDeltas.get(item.productId) ?? 0) +
        item.consumedQuantity -
        nextConsumedQuantity,
    )
  }

  return {
    itemChanges,
    productChanges: [...productQuantityDeltas.entries()]
      .filter(([, quantityDelta]) => quantityDelta !== 0)
      .map(([productId, quantityDelta]) => ({ productId, quantityDelta })),
  }
}

/**
 * What a mutation of the reservation's consumables would change, read under
 * the locks it takes (the reservation, then its consumable lines and their
 * products, by id), checked as it would be applied: a product missing, or
 * a quantity that would fall below zero, throws `ConsumableStockError`.
 * Null when nothing would change. It writes nothing.
 */
async function checkedStockPlan(
  tx: Transaction,
  reservationId: string,
  storeId: string,
  mode: ConsumableStockMutationMode,
): Promise<ConsumableStockMutationPlan | null> {
  const lockedReservation = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)))
    .for('update')

  if (lockedReservation.length === 0) {
    throw new ConsumableStockError({
      code: 'RESERVATION_NOT_FOUND',
      message: 'errors.reservationNotFound',
    })
  }

  const items = await tx
    .select({
      itemId: reservationItems.id,
      productId: reservationItems.productId,
      quantity: reservationItems.quantity,
      consumedQuantity: reservationItems.consumedQuantity,
    })
    .from(reservationItems)
    .innerJoin(products, eq(reservationItems.productId, products.id))
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(
        eq(reservationItems.reservationId, reservationId),
        eq(reservations.storeId, storeId),
        eq(products.storeId, storeId),
        eq(products.stockKind, 'consumable'),
      ),
    )
    .orderBy(products.id, reservationItems.id)
    .for('update')

  const consumableItems = items.flatMap((item) =>
    item.productId
      ? [
          {
            itemId: item.itemId,
            productId: item.productId,
            quantity: item.quantity,
            consumedQuantity: item.consumedQuantity,
          },
        ]
      : [],
  )
  const plan = planConsumableStockMutation(consumableItems, mode)

  if (plan.itemChanges.length === 0) {
    return null
  }

  const productIds = plan.productChanges.map((change) => change.productId)
  const lockedProducts = await tx
    .select({ id: products.id, quantity: products.quantity })
    .from(products)
    .where(
      and(
        eq(products.storeId, storeId),
        eq(products.stockKind, 'consumable'),
        inArray(products.id, productIds),
      ),
    )
    .orderBy(products.id)
    .for('update')
  const quantityByProductId = new Map(
    lockedProducts.map((product) => [product.id, product.quantity]),
  )

  for (const change of plan.productChanges) {
    const currentQuantity = quantityByProductId.get(change.productId)
    if (currentQuantity === undefined) {
      throw new ConsumableStockError({
        code: 'PRODUCT_NOT_FOUND',
        message: 'errors.productNotFound',
        productId: change.productId,
      })
    }

    const nextQuantity = currentQuantity + change.quantityDelta
    if (nextQuantity < 0) {
      throw new ConsumableStockError({
        code: 'INSUFFICIENT_STOCK',
        message: 'errors.consumableInsufficientStock',
        productId: change.productId,
        requestedQuantity: -change.quantityDelta,
        availableQuantity: currentQuantity,
      })
    }
  }

  return plan
}

async function mutateReservationStock(
  tx: Transaction,
  reservationId: string,
  storeId: string,
  mode: ConsumableStockMutationMode,
): Promise<void> {
  // A test reservation is checked against the real stock but never takes or
  // gives back a consumable (test-reservations.ts).
  if (await isTestReservation(tx, reservationId)) return
  const plan = await checkedStockPlan(tx, reservationId, storeId, mode)
  if (!plan) return

  for (const change of plan.productChanges) {
    await tx
      .update(products)
      .set({
        quantity: sql`${products.quantity} + ${change.quantityDelta}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(products.id, change.productId),
          eq(products.storeId, storeId),
          eq(products.stockKind, 'consumable'),
        ),
      )
  }

  for (const change of plan.itemChanges) {
    await tx
      .update(reservationItems)
      .set({ consumedQuantity: change.consumedQuantity })
      .where(
        and(
          eq(reservationItems.id, change.itemId),
          eq(reservationItems.reservationId, reservationId),
        ),
      )
  }
}

/**
 * Takes the reservation's consumables, under its products' lock: a lock from
 * the owner entry (`runReservationChange`), or the one `insertReservation`
 * gives for the row it inserted after locking its products, which this use
 * spends. The reservation is the one the lock was issued for.
 */
export async function consumeReservationStock(
  tx: Transaction,
  lock: ReservationStockLock,
): Promise<void> {
  const grant = assertReservationLock(tx, lock, ['products', 'inserted'])
  await mutateReservationStock(tx, grant.reservationId, grant.storeId, 'consume')
}

/**
 * Whether the reservation's consumables can be taken, as
 * `consumeReservationStock` would take them, under its products' lock
 * (`runReservationChange`): throws the `ConsumableStockError` that taking
 * them would throw, and writes nothing. A change that asks someone first
 * checks it before it asks: no override passes a consumable short.
 */
export async function checkReservationConsumables(
  tx: Transaction,
  lock: ReservationProductsLock,
): Promise<void> {
  const grant = assertReservationLock(tx, lock, ['products'])
  await checkedStockPlan(tx, grant.reservationId, grant.storeId, 'consume')
}

/**
 * One line of a reservation's stock demand as a status change takes it, as
 * read under its locks (`readReservationStockDemand`): what it books (the
 * product, the quantity, the variant as the line stores it, with the
 * product's booking axes to read it by, the units assigned to it) and, for a
 * consumable, what is consumed and what the change takes.
 */
export interface ReservationDemandLine {
  line: string
  product: string
  quantity: number
  /** The line's combination: null for a line served by any unit that matches its choice. */
  combinationKey: string | null
  /** The attributes the line chose, as stored; read against `axes` (packages/api `stockDemandOf`). */
  selectedAttributes: UnitAttributes | null
  axes: BookingAttributeAxis[] | null
  /** The ids of the units assigned to it, sorted. */
  units: string[]
  /** A consumable's units already taken, and what the change takes (negative: gives back). */
  consumable?: { consumed: number; takes: number }
}

/**
 * The reservation's stock demand as a status change will take it, under its
 * products' lock (`runReservationChange`): per line with a product, the
 * product, the quantity, the variant and the assigned units, and for a
 * consumable what is already consumed and what `action` takes (`consume`:
 * up to the quantity; `restore`: all of it back; null: nothing), in the
 * lines' id order. A confirmation binds it (in its canonical form,
 * packages/api `stockDemandOf`), so a line changed since its preview voids
 * the preview's token or approval. Writes nothing.
 */
export async function readReservationStockDemand(
  tx: Transaction,
  lock: ReservationProductsLock,
  action: 'consume' | 'restore' | null,
): Promise<ReservationDemandLine[]> {
  const grant = assertReservationLock(tx, lock, ['products'])
  const rows = await tx
    .select({
      line: reservationItems.id,
      product: products.id,
      quantity: reservationItems.quantity,
      consumed: reservationItems.consumedQuantity,
      combinationKey: reservationItems.combinationKey,
      selectedAttributes: reservationItems.selectedAttributes,
      axes: products.bookingAttributeAxes,
      stockKind: products.stockKind,
    })
    .from(reservationItems)
    .innerJoin(products, eq(reservationItems.productId, products.id))
    .where(
      and(
        eq(reservationItems.reservationId, grant.reservationId),
        eq(products.storeId, grant.storeId),
      ),
    )
    .orderBy(reservationItems.id)
    .for('update')
  const assigned =
    rows.length === 0
      ? []
      : await tx
          .select({
            line: reservationItemUnits.reservationItemId,
            unit: reservationItemUnits.productUnitId,
          })
          .from(reservationItemUnits)
          .where(
            inArray(
              reservationItemUnits.reservationItemId,
              rows.map((row) => row.line),
            ),
          )
          .orderBy(reservationItemUnits.reservationItemId, reservationItemUnits.productUnitId)
          .for('update')
  return rows.map(({ consumed, stockKind, ...row }) => {
    const units = assigned.flatMap((entry) =>
      entry.line === row.line && entry.unit ? [entry.unit] : [],
    )
    const demand = {
      line: row.line,
      product: row.product,
      quantity: row.quantity,
      combinationKey: row.combinationKey,
      selectedAttributes: row.selectedAttributes,
      axes: row.axes,
      units,
    }
    if (stockKind !== 'consumable') return demand
    const takes =
      action === 'consume'
        ? Math.max(consumed, row.quantity) - consumed
        : action === 'restore'
          ? -consumed
          : 0
    return { ...demand, consumable: { consumed, takes } }
  })
}

/** Gives the reservation's consumables back, under its products' lock (`runReservationChange`). */
export async function restoreReservationStock(
  tx: Transaction,
  lock: ReservationProductsLock,
): Promise<void> {
  const grant = assertReservationLock(tx, lock, ['products'])
  await mutateReservationStock(tx, grant.reservationId, grant.storeId, 'restore')
}

export async function reconcileReservationStock(
  tx: Transaction,
  reservationId: string,
  storeId: string,
): Promise<void> {
  await mutateReservationStock(tx, reservationId, storeId, 'reconcile')
}

export async function loadConsumableReservedQuantities(
  database: Pick<Database, 'select'>,
  params: {
    storeId: string
    productIds: string[]
    blockingStatuses: BlockingReservationStatus[]
    excludeReservationId?: string
  },
): Promise<Map<string, number>> {
  if (params.productIds.length === 0) {
    return new Map()
  }

  // The same reservations as returnable stock counts: a pending marketplace
  // booking whose hold expired holds nothing.
  const reservationPredicate = and(
    eq(reservations.storeId, params.storeId),
    inArray(reservations.status, params.blockingStatuses),
    buildReservationAvailabilityPredicate(database),
    params.excludeReservationId ? ne(reservations.id, params.excludeReservationId) : undefined,
  )
  const rows = await database
    .select({
      productId: reservationItems.productId,
      quantity: reservationItems.quantity,
      consumedQuantity: reservationItems.consumedQuantity,
    })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .innerJoin(products, eq(reservationItems.productId, products.id))
    .where(
      and(
        reservationPredicate,
        eq(products.storeId, params.storeId),
        eq(products.stockKind, 'consumable'),
        inArray(products.id, params.productIds),
      ),
    )
  const reservedByProduct = new Map<string, number>()

  for (const row of rows) {
    if (!row.productId) {
      continue
    }

    const heldQuantity = Math.max(0, row.quantity - row.consumedQuantity)
    reservedByProduct.set(row.productId, (reservedByProduct.get(row.productId) ?? 0) + heldQuantity)
  }

  return reservedByProduct
}
