import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getCartRequestedQuantity } from './cart-demand';

test('aggregates returnable lines whose periods overlap and selection matches', () => {
  const lines = [
    {
      lineId: 'required-fluid',
      parentLineId: 'smoke-machine',
      productId: 'fog-fluid',
      quantity: 15,
      startDate: '2026-08-27T09:00:00.000Z',
      endDate: '2026-08-27T18:00:00.000Z',
    },
    {
      lineId: 'free-fluid',
      productId: 'fog-fluid',
      quantity: 15,
      startDate: '2026-08-27T09:00:00.000Z',
      endDate: '2026-08-27T18:00:00.000Z',
    },
  ];

  assert.equal(getCartRequestedQuantity(lines, lines[0], 'returnable'), 30);
});

test('does not aggregate returnable lines on separate rental dates', () => {
  const lines = [
    {
      productId: 'helmet',
      quantity: 1,
      startDate: '2026-08-27T09:00:00.000Z',
      endDate: '2026-08-27T18:00:00.000Z',
    },
    {
      productId: 'helmet',
      quantity: 1,
      startDate: '2026-08-28T09:00:00.000Z',
      endDate: '2026-08-28T18:00:00.000Z',
    },
  ];

  assert.equal(getCartRequestedQuantity(lines, lines[0], 'returnable'), 1);
  assert.equal(getCartRequestedQuantity(lines, lines[1], 'returnable'), 1);
});
