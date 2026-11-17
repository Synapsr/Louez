import assert from 'node:assert/strict'
import { test } from 'node:test'

import { toPricingCatalogProduct } from '@louez/api/services/catalogue-line-pricing'
import type { PricingBreakdown, PricingKind, PricingMode } from '@louez/types'

import type { EditableItem } from '../types'
import {
  calculateEditableItemPrice,
  calculateUnitPriceFromTotal,
  editSummaryFigures,
  previewEditTotals,
} from './use-edit-reservation-pricing'

/** A product as the server's catalogue holds it (`loadPricingCatalog`). */
const catalogueOf = (product: {
  price: string
  pricingKind: PricingKind
  pricingMode: PricingMode
  basePeriodMinutes: number | null
  rates?: Array<{ id: string; period: number; price: string }>
}) =>
  toPricingCatalogProduct(
    {
      id: 'product-1',
      name: 'Included media set',
      description: null,
      images: [],
      price: product.price,
      deposit: '0.00',
      pricingKind: product.pricingKind,
      pricingMode: product.pricingMode,
      basePeriodMinutes: product.basePeriodMinutes,
      enforceStrictTiers: false,
      stockKind: 'consumable',
      quantity: 10,
      trackUnits: false,
      bookingAttributeAxes: null,
      taxSettings: null,
      promotion: null,
    },
    (product.rates ?? []).map((rate) => ({
      ...rate,
      minDuration: 0,
      discountPercent: '0',
      displayOrder: 0,
    })),
    [],
  )

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
    catalogue: catalogueOf({
      price: '15.00',
      pricingKind: 'fixed',
      pricingMode: 'day',
      basePeriodMinutes: null,
    }),
  },
  stored: null,
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
    catalogue: catalogueOf({
      price: '2.50',
      pricingKind: 'duration',
      pricingMode: 'hour',
      basePeriodMinutes: 60,
      rates: [{ id: 'day-rate', period: 1440, price: '18.00' }],
    }),
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
  storeTax: Parameters<typeof previewEditTotals>[0]['storeTax'],
  recorded: 'inclusive' | 'exclusive' | null = null,
) =>
  previewEditTotals({
    items: [previewLine],
    insuranceAmount: 0,
    discountAmount: 0,
    deliveryFee: 0,
    deposit: 0,
    storeTax,
    recordedTaxDisplayMode: recorded,
  }).total

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
  const { total } = previewEditTotals({
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

// The line prices of the edit (slice 11), as the form previews them.
const dayItem: EditableItem = {
  ...fixedProductItem,
  quantity: 1,
  unitPrice: 15,
  isManualPrice: false,
  product: { ...fixedProductItem.product!, price: '15.00', pricingKind: 'duration' },
}
const TWO_DAYS = [new Date('2031-06-10T09:00:00.000Z'), new Date('2031-06-12T09:00:00.000Z')] as const
const THREE_DAYS = [new Date('2031-06-10T09:00:00.000Z'), new Date('2031-06-13T09:00:00.000Z')] as const

const stored = (totalPrice: number, pricingBreakdown: PricingBreakdown | null = null) => ({
  quantity: 1,
  unitPrice: totalPrice,
  totalPrice,
  taxRate: 20,
  pricingBreakdown,
})
const dayBreakdown = (duration: number, price: number, extra: Partial<PricingBreakdown> = {}): PricingBreakdown => ({
  basePrice: price,
  effectivePrice: price,
  duration,
  pricingMode: 'day',
  pricingKind: 'duration',
  discountPercent: null,
  discountAmount: 0,
  tierApplied: null,
  taxRate: null,
  taxAmount: null,
  subtotalExclTax: null,
  subtotalInclTax: null,
  ...extra,
})

test('the preview of a line the edit leaves as it was: its stored price and rate', () => {
  // Booked at 10.00 a day, 20.00; the product costs 15.00 now.
  const result = calculateEditableItemPrice({ ...dayItem, stored: stored(20) }, ...TWO_DAYS)
  assert.equal(result.totalPrice, 20)
  assert.deepEqual(result.tax, { kind: 'recorded', rate: 20 })
  // The same line once the window moved: priced again from the catalogue.
  assert.equal(calculateEditableItemPrice({ ...dayItem, stored: stored(20) }, ...THREE_DAYS, undefined, true).totalPrice, 45)
})

test('the preview of a promoted line whose window moved: the promotion recorded applied', () => {
  const tenADay = {
    ...dayItem,
    product: { ...dayItem.product!, price: '10.00' },
    stored: stored(16, dayBreakdown(2, 10, { promotion: { percentage: 20, originalSubtotal: 20, discountAmount: 4 } })),
  }
  assert.equal(calculateEditableItemPrice(tenADay, ...THREE_DAYS, undefined, true).totalPrice, 24)
})

test('the preview of a line whose product is gone: what it stored, or its stored total when the server refuses', () => {
  // 90.00 for three days, as the dashboard stored it; the product deleted since.
  const minutes = dayBreakdown(4320, 30, { durationMinutes: 4320 })
  const gone = { ...dayItem, unitPrice: 90, product: null, stored: stored(90, minutes) }
  assert.equal(calculateEditableItemPrice(gone, ...THREE_DAYS).totalPrice, 90)
  // Three units at 90.00 for two: in proportion, rounded once.
  assert.equal(calculateEditableItemPrice({ ...gone, quantity: 3 }, ...THREE_DAYS).totalPrice, 270)
  // Its window moved: the server refuses; the stored total stays on screen.
  const fourDays = new Date('2031-06-14T09:00:00.000Z')
  assert.equal(calculateEditableItemPrice(gone, THREE_DAYS[0], fourDays, undefined, true).totalPrice, 90)
})

test('the preview total: a line kept at its stored price keeps the rate it recorded', () => {
  // The store's rate is 10 % now; the kept line recorded 20 %.
  const { total } = previewEditTotals({
    items: [
      { totalPrice: 20, effectiveUnitPrice: 10, product: dayItem.product, tax: { kind: 'recorded', rate: 20 } },
      { totalPrice: 40, effectiveUnitPrice: 10, product: dayItem.product, tax: { kind: 'today' } },
    ],
    insuranceAmount: 0,
    discountAmount: 0,
    deliveryFee: 0,
    deposit: 0,
    storeTax: { enabled: true, defaultRate: 10, displayMode: 'exclusive' },
    recordedTaxDisplayMode: 'exclusive',
  })
  assert.equal(total, 68)
})

// The summary shows what is stored and what will be written, each a total tax
// included; the subtotal and the tax as lines of their own when prices are
// given before tax, as the creation form shows them.
const summaryOf = (
  storeTax: Parameters<typeof previewEditTotals>[0]['storeTax'],
  storedTotal: number,
  currency = 'EUR',
  items = [previewLine],
) =>
  editSummaryFigures({
    storedTotal,
    preview: previewEditTotals({
      items,
      insuranceAmount: 0,
      discountAmount: 0,
      deliveryFee: 0,
      deposit: 0,
      storeTax,
      recordedTaxDisplayMode: null,
      currency,
    }),
    discountAmount: 0,
    currency,
  })

test('the summary, prices before tax: after is the total tax included, with its subtotal and tax', () => {
  // Stored at 120.00 for 100.00 before tax; the line now 150.00 before tax.
  const figures = summaryOf({ enabled: true, defaultRate: 20, displayMode: 'exclusive' }, 120)
  assert.equal(figures.before, 120)
  assert.equal(figures.after, 180)
  assert.equal(figures.difference, 60)
  assert.deepEqual(figures.taxLines, { subtotal: 150, tax: 30 })
})

test('the summary, prices with tax: no tax line, the totals as written', () => {
  const figures = summaryOf({ enabled: true, defaultRate: 20, displayMode: 'inclusive' }, 120)
  assert.equal(figures.after, 150)
  assert.equal(figures.difference, 30)
  assert.equal(figures.taxLines, null)
})

test('the summary, taxes off: no tax line', () => {
  const figures = summaryOf(undefined, 120)
  assert.equal(figures.after, 150)
  assert.equal(figures.taxLines, null)
})

test('the summary in yen: whole yen, the tax on top', () => {
  // ¥315 before tax at 20 %: ¥63 of tax, ¥378; stored at ¥360.
  const figures = summaryOf(
    { enabled: true, defaultRate: 20, displayMode: 'exclusive' },
    360,
    'JPY',
    [{ totalPrice: 315, effectiveUnitPrice: 315, product: null }],
  )
  assert.equal(figures.after, 378)
  assert.equal(figures.difference, 18)
  assert.deepEqual(figures.taxLines, { subtotal: 315, tax: 63 })
})

test('the summary keeps the stored discount as a line of its own', () => {
  const figures = editSummaryFigures({
    storedTotal: 100,
    preview: { subtotal: 150, taxAmount: null, total: 140, taxOnTop: false },
    discountAmount: 10,
    currency: 'EUR',
  })
  assert.equal(figures.discount, 10)
  assert.equal(figures.difference, 40)
})
