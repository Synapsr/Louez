import { and, eq, inArray, ne, sql } from 'drizzle-orm'

import type { Database, Transaction } from './index'
import { products, reservationItems, reservations } from './schema'
import type { BlockingReservationStatus } from './unit-availability'

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

type ReservationStatus = typeof reservations.$inferSelect.status

export function reservationStatusConsumesStock(status: ReservationStatus): boolean {
  return status === 'confirmed' || status === 'ongoing'
}

export function canChangeProductStockKind(statuses: ReservationStatus[]): boolean {
  return statuses.every((status) => !reservationStatusConsumesStock(status))
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

async function mutateReservationStock(
  tx: Transaction,
  reservationId: string,
  storeId: string,
  mode: ConsumableStockMutationMode,
): Promise<void> {
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
    return
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

export async function consumeReservationStock(
  tx: Transaction,
  reservationId: string,
  storeId: string,
): Promise<void> {
  await mutateReservationStock(tx, reservationId, storeId, 'consume')
}

export async function restoreReservationStock(
  tx: Transaction,
  reservationId: string,
  storeId: string,
): Promise<void> {
  await mutateReservationStock(tx, reservationId, storeId, 'restore')
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

  const reservationPredicate = params.excludeReservationId
    ? and(
        eq(reservations.storeId, params.storeId),
        inArray(reservations.status, params.blockingStatuses),
        ne(reservations.id, params.excludeReservationId),
      )
    : and(
        eq(reservations.storeId, params.storeId),
        inArray(reservations.status, params.blockingStatuses),
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
