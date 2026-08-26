import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getCartRequestedQuantity } from './cart-demand';

test('aggregates returnable lines sharing a product, period and selection', () => {
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
