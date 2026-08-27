import assert from 'node:assert/strict'
import { test } from 'node:test'

import { calculatePeakReservedQuantities } from './availability'

const requestedStart = new Date('2026-09-10T10:00:00.000Z')
const requestedEnd = new Date('2026-09-10T12:00:00.000Z')

test('confirmed consumables do not reserve stock after their quantity was consumed', () => {
  const result = calculatePeakReservedQuantities({
    reservations: [
      {
        status: 'confirmed',
        startDate: requestedStart,
        endDate: requestedEnd,
        items: [
          {
            productId: 'consumable',
            stockKind: 'consumable',
            quantity: 4,
            consumedQuantity: 4,
          },
        ],
      },
    ],
    startDate: requestedStart,
    endDate: requestedEnd,
  })

  assert.equal(result.reservedByProduct.get('consumable') ?? 0, 0)
})

test('pending consumables reserve unconsumed stock independently of dates', () => {
  const result = calculatePeakReservedQuantities({
    reservations: [
      {
        status: 'pending',
        startDate: new Date('2027-01-01T10:00:00.000Z'),
        endDate: new Date('2027-01-01T12:00:00.000Z'),
        items: [
          {
            productId: 'consumable',
            stockKind: 'consumable',
            quantity: 3,
            consumedQuantity: 0,
          },
        ],
      },
    ],
    startDate: requestedStart,
    endDate: requestedEnd,
    pendingBlocksAvailability: true,
  })

  assert.equal(result.reservedByProduct.get('consumable'), 3)
})

test('pending consumables do not reserve stock when pending reservations do not block', () => {
  const result = calculatePeakReservedQuantities({
    reservations: [
      {
        status: 'pending',
        startDate: requestedStart,
        endDate: requestedEnd,
        items: [
          {
            productId: 'consumable',
            stockKind: 'consumable',
            quantity: 3,
            consumedQuantity: 0,
          },
        ],
      },
    ],
    startDate: requestedStart,
    endDate: requestedEnd,
    pendingBlocksAvailability: false,
  })

  assert.equal(result.reservedByProduct.get('consumable') ?? 0, 0)
})

test('returnable products keep temporal peak availability', () => {
  const result = calculatePeakReservedQuantities({
    reservations: [
      {
        status: 'confirmed',
        startDate: requestedStart,
        endDate: requestedEnd,
        items: [
          {
            productId: 'returnable',
            stockKind: 'returnable',
            quantity: 2,
            consumedQuantity: 0,
          },
        ],
      },
    ],
    startDate: requestedStart,
    endDate: requestedEnd,
  })

  assert.equal(result.reservedByProduct.get('returnable'), 2)
})

test('untracked products never reserve stock capacity', () => {
  const result = calculatePeakReservedQuantities({
    reservations: [
      {
        status: 'confirmed',
        startDate: requestedStart,
        endDate: requestedEnd,
        items: [
          {
            productId: 'cleaning-service',
            stockKind: 'untracked',
            quantity: 50,
            consumedQuantity: 0,
          },
        ],
      },
    ],
    startDate: requestedStart,
    endDate: requestedEnd,
  })

  assert.equal(result.reservedByProduct.has('cleaning-service'), false)
})
