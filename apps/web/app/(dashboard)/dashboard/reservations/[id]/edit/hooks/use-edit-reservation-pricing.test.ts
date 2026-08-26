import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { EditableItem } from '../types'
import {
  calculateEditableItemPrice,
  calculateUnitPriceFromTotal,
} from './use-edit-reservation-pricing'

const fixedProductItem: EditableItem = {
  id: 'item-1',
  productId: 'product-1',
  quantity: 2,
  consumedQuantity: 0,
  unitPrice: 15,
  depositPerUnit: 0,
  isManualPrice: true,
  pricingMode: 'day',
  basePeriodMinutes: null,
  enforceStrictTiers: false,
  productSnapshot: {
    name: 'Included media set',
    description: null,
    images: [],
  },
  product: {
    id: 'product-1',
    name: 'Included media set',
    price: '15.00',
    deposit: '0.00',
    images: [],
    tulipInsurable: false,
    quantity: 10,
    stockKind: 'consumable',
    pricingKind: 'fixed',
    pricingMode: 'day',
    basePeriodMinutes: null,
    enforceStrictTiers: false,
    pricingTiers: [],
    seasonalPricings: [],
  },
}

test('manual fixed-price overrides stay independent of reservation dates', () => {
  const result = calculateEditableItemPrice(
    fixedProductItem,
    new Date('2026-08-01T10:00:00.000Z'),
    new Date('2026-08-04T10:00:00.000Z'),
  )

  assert.equal(result.duration, 1)
  assert.equal(result.totalPrice, 30)
  assert.equal(result.effectiveUnitPrice, 15)
})

test('a fixed total-price override divides by quantity but not duration', () => {
  assert.equal(
    calculateUnitPriceFromTotal({
      totalPrice: 40,
      quantity: 2,
      duration: 3,
      pricingKind: 'fixed',
    }),
    20,
  )
})
