import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { EditableItem } from '../types'
import {
  calculateEditableItemPrice,
  calculateUnitPriceFromTotal,
  previewEditTotal,
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

const hourlyRateItem: EditableItem = {
  ...fixedProductItem,
  quantity: 1,
  unitPrice: 2.5,
  isManualPrice: false,
  pricingMode: 'hour',
  basePeriodMinutes: 60,
  product: {
    ...fixedProductItem.product!,
    price: '2.50',
    pricingKind: 'duration',
    pricingMode: 'hour',
    basePeriodMinutes: 60,
    pricingTiers: [{ id: 'day-rate', minDuration: 0, discountPercent: 0, period: 1440, price: 18 }],
  },
}

test('a day rate on an hourly product is labelled in days, not hours', () => {
  const result = calculateEditableItemPrice(
    hourlyRateItem,
    new Date('2026-09-30T15:30:00.000Z'),
    new Date('2026-10-01T15:30:00.000Z'),
    'UTC',
  )

  assert.equal(result.totalPrice, 18)
  assert.equal(result.displayPricingMode, 'day')
  assert.equal(result.displayDuration, 1)
  assert.equal(result.effectiveUnitPrice, 18)
})

test('an ordinary rate is not reported as savings', () => {
  const result = calculateEditableItemPrice(
    hourlyRateItem,
    new Date('2026-09-30T15:30:00.000Z'),
    new Date('2026-10-01T15:30:00.000Z'),
    'UTC',
  )

  assert.equal(result.savings, 0)
})

// The preview shows the total the edit writes (slice 10): the same engine, the
// same inputs. A line of 150.00 at 20 %, the server's numbers
// (actions.db.test.ts, edit-totals.db.test.ts).
const previewLine = { totalPrice: 150, effectiveUnitPrice: 75, product: null }
const previewOf = (
  storeTax: Parameters<typeof previewEditTotal>[0]['storeTax'],
  recorded: 'inclusive' | 'exclusive' | null = null,
) =>
  previewEditTotal({
    items: [previewLine],
    insuranceAmount: 0,
    discountAmount: 0,
    deliveryFee: 0,
    deposit: 0,
    storeTax,
    recordedTaxDisplayMode: recorded,
  })

test('the preview total: prices before tax, the tax on top', () => {
  assert.equal(previewOf({ enabled: true, defaultRate: 20, displayMode: 'exclusive' }), 180)
})

test('the preview total: prices with tax, unchanged', () => {
  assert.equal(previewOf({ enabled: true, defaultRate: 20, displayMode: 'inclusive' }), 150)
})

test('the preview total: taxes off, unchanged', () => {
  assert.equal(previewOf(undefined), 150)
})

test('the preview total: the mode the reservation recorded, not the store\'s today', () => {
  assert.equal(
    previewOf({ enabled: true, defaultRate: 20, displayMode: 'exclusive' }, 'inclusive'),
    150,
  )
})

test('the preview total: insurance outside the tax, the discount and the delivery in', () => {
  const total = previewEditTotal({
    items: [previewLine],
    insuranceAmount: 12.5,
    discountAmount: 10,
    deliveryFee: 20,
    deposit: 0,
    storeTax: { enabled: true, defaultRate: 20, displayMode: 'exclusive' },
    recordedTaxDisplayMode: null,
  })
  // (150 - 10 + 20) before tax, 20 % on top, and 12.50 of insurance with none.
  assert.equal(total, 204.5)
})
