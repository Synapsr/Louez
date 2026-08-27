import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateRequiredAccessoryLines } from './required-accessories';

test('required accessories must accompany their parent at the configured quantity', () => {
  const result = validateRequiredAccessoryLines({
    lines: [
      { productId: 'parent', quantity: 2 },
      { productId: 'accessory', quantity: 1 },
    ],
    requiredAccessories: [
      {
        parentProductId: 'parent',
        accessoryProductId: 'accessory',
        quantity: 2,
      },
    ],
  });

  assert.deepEqual(result, {
    valid: false,
    missing: [
      {
        parentProductId: 'parent',
        accessoryProductId: 'accessory',
        requiredQuantity: 4,
        providedQuantity: 1,
      },
    ],
  });
});

test('additional accessory quantities remain valid', () => {
  const result = validateRequiredAccessoryLines({
    lines: [
      { productId: 'parent', quantity: 2 },
      { productId: 'accessory', quantity: 5 },
    ],
    requiredAccessories: [
      {
        parentProductId: 'parent',
        accessoryProductId: 'accessory',
        quantity: 2,
      },
    ],
  });

  assert.deepEqual(result, { valid: true, missing: [] });
});

test('requirements from multiple parents sharing an accessory are cumulative', () => {
  const result = validateRequiredAccessoryLines({
    lines: [
      { productId: 'parent-a', quantity: 1 },
      { productId: 'parent-b', quantity: 2 },
      { productId: 'accessory', quantity: 2 },
    ],
    requiredAccessories: [
      {
        parentProductId: 'parent-a',
        accessoryProductId: 'accessory',
        quantity: 1,
      },
      {
        parentProductId: 'parent-b',
        accessoryProductId: 'accessory',
        quantity: 1,
      },
    ],
  });

  assert.deepEqual(result, {
    valid: false,
    missing: [
      {
        parentProductId: 'parent-a',
        accessoryProductId: 'accessory',
        requiredQuantity: 3,
        providedQuantity: 2,
      },
    ],
  });
});
