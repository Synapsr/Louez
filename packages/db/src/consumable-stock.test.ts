import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canTransitionReservationStatus,
  canChangeProductStockKind,
  planConsumableStockMutation,
  reservationStatusConsumesStock,
} from './consumable-stock'

const item = {
  itemId: 'item-1',
  productId: 'product-1',
  quantity: 3,
  consumedQuantity: 0,
}

test('consume is idempotent through consumedQuantity', () => {
  const first = planConsumableStockMutation([item], 'consume')

  assert.deepEqual(first, {
    itemChanges: [{ itemId: 'item-1', consumedQuantity: 3 }],
    productChanges: [{ productId: 'product-1', quantityDelta: -3 }],
  })

  const replay = planConsumableStockMutation([{ ...item, consumedQuantity: 3 }], 'consume')

  assert.deepEqual(replay, { itemChanges: [], productChanges: [] })
})

test('restore returns consumed stock and is idempotent', () => {
  const first = planConsumableStockMutation([{ ...item, consumedQuantity: 3 }], 'restore')

  assert.deepEqual(first, {
    itemChanges: [{ itemId: 'item-1', consumedQuantity: 0 }],
    productChanges: [{ productId: 'product-1', quantityDelta: 3 }],
  })

  const replay = planConsumableStockMutation([item], 'restore')
  assert.deepEqual(replay, { itemChanges: [], productChanges: [] })
})

test('reservation edit applies positive and negative consumed deltas', () => {
  const increase = planConsumableStockMutation(
    [{ ...item, quantity: 5, consumedQuantity: 3 }],
    'reconcile',
  )
  const decrease = planConsumableStockMutation(
    [{ ...item, quantity: 1, consumedQuantity: 3 }],
    'reconcile',
  )

  assert.deepEqual(increase, {
    itemChanges: [{ itemId: 'item-1', consumedQuantity: 5 }],
    productChanges: [{ productId: 'product-1', quantityDelta: -2 }],
  })
  assert.deepEqual(decrease, {
    itemChanges: [{ itemId: 'item-1', consumedQuantity: 1 }],
    productChanges: [{ productId: 'product-1', quantityDelta: 2 }],
  })
})

test('stock kind cannot change while a reservation can still restore consumed stock', () => {
  assert.equal(canChangeProductStockKind(['confirmed']), false)
  assert.equal(canChangeProductStockKind(['ongoing']), false)
  assert.equal(canChangeProductStockKind(['pending', 'quote']), true)
  assert.equal(
    canChangeProductStockKind(['completed', 'cancelled', 'rejected', 'declined']),
    true,
  )
})

test('reservation edits reconcile stock only while the locked status consumes stock', () => {
  assert.equal(reservationStatusConsumesStock('confirmed'), true)
  assert.equal(reservationStatusConsumesStock('ongoing'), true)
  assert.equal(reservationStatusConsumesStock('cancelled'), false)
  assert.equal(reservationStatusConsumesStock('rejected'), false)
  assert.equal(reservationStatusConsumesStock('completed'), false)
})

test('status transitions are revalidated from the locked reservation state', () => {
  assert.equal(canTransitionReservationStatus('pending', 'confirmed'), true)
  assert.equal(canTransitionReservationStatus('quote', 'confirmed'), true)
  assert.equal(canTransitionReservationStatus('quote', 'declined'), true)
  assert.equal(canTransitionReservationStatus('confirmed', 'cancelled'), true)
  assert.equal(canTransitionReservationStatus('ongoing', 'cancelled'), true)
  assert.equal(canTransitionReservationStatus('cancelled', 'confirmed'), false)
  assert.equal(canTransitionReservationStatus('completed', 'confirmed'), false)
})
