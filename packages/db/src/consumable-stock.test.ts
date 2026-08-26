import assert from 'node:assert/strict'
import { test } from 'node:test'

import { planConsumableStockMutation } from './consumable-stock'

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
