import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRequiredAccessoryCartInputs,
  clampRequiredAccessoryLineQuantity,
  findBlockingRequiredAccessories,
  getCartLineAvailableMaximumQuantity,
  groupCartLinesByParent,
  reconcileRequiredAccessoryLineQuantity,
  selectOptionalAccessories,
} from './cart-required-accessories';

const mediaSet = {
  id: 'media-set',
  name: 'Media set',
  price: '0.00',
  deposit: '0',
  images: null,
  quantity: 4,
  required: true,
  requiredQuantity: 2,
  pricingKind: 'fixed' as const,
  pricingMode: 'day' as const,
};

const tripod = {
  id: 'tripod',
  name: 'Tripod',
  price: '9.50',
  deposit: '20',
  images: ['tripod.jpg'],
  quantity: 3,
  required: false,
  requiredQuantity: 1,
  pricingKind: 'duration' as const,
  pricingMode: 'day' as const,
};

test('splits required accessories from the upsell list', () => {
  assert.deepEqual(
    selectOptionalAccessories([mediaSet, tripod]).map(
      (accessory) => accessory.id,
    ),
    ['tripod'],
  );
});

test('builds a cart input carrying the per-parent-unit requirement', () => {
  const [input] = buildRequiredAccessoryCartInputs([mediaSet, tripod]);

  assert.equal(input.productId, 'media-set');
  assert.equal(input.requiredQuantity, 2);
  assert.equal(input.price, 0);
  assert.equal(input.maxQuantity, 4);
});

test('flags a required accessory that cannot cover the parent quantity', () => {
  assert.equal(findBlockingRequiredAccessories([mediaSet], 2).length, 0);
  assert.equal(findBlockingRequiredAccessories([mediaSet], 3).length, 1);
  // An optional accessory never blocks its parent.
  assert.equal(
    findBlockingRequiredAccessories([{ ...tripod, quantity: 0 }], 1).length,
    0,
  );
});

test('allows extra required accessories without going below the parent minimum', () => {
  const line = {
    requiredQuantity: 2,
    maxQuantity: 8,
  };

  assert.equal(
    clampRequiredAccessoryLineQuantity(line, {
      parentQuantity: 2,
      requestedQuantity: 3,
    }),
    4,
  );
  assert.equal(
    clampRequiredAccessoryLineQuantity(line, {
      parentQuantity: 2,
      requestedQuantity: 5,
    }),
    5,
  );
  assert.equal(
    clampRequiredAccessoryLineQuantity(line, {
      parentQuantity: 2,
      requestedQuantity: 12,
    }),
    8,
  );
});

test('preserves the selected total when the parent quantity changes', () => {
  const line = {
    quantity: 3,
    requiredQuantity: 1,
    maxQuantity: 8,
  };

  assert.equal(
    reconcileRequiredAccessoryLineQuantity(line, {
      nextParentQuantity: 2,
      nextRequiredQuantity: 1,
    }),
    3,
  );
  assert.equal(
    reconcileRequiredAccessoryLineQuantity(
      { ...line, quantity: 4 },
      {
        nextParentQuantity: 1,
        nextRequiredQuantity: 1,
      },
    ),
    4,
  );
  assert.equal(
    reconcileRequiredAccessoryLineQuantity(line, {
      nextParentQuantity: 2,
      nextRequiredQuantity: 2,
    }),
    4,
  );
});

test('shares an accessory stock cap across every cart line', () => {
  const lines = [
    {
      lineId: 'parent',
      productId: 'smoke-machine',
      quantity: 1,
      maxQuantity: 5,
    },
    {
      lineId: 'required-fluid',
      parentLineId: 'parent',
      productId: 'fog-fluid',
      stockKind: 'consumable' as const,
      quantity: 1,
      maxQuantity: 5,
      requiredQuantity: 1,
    },
    {
      lineId: 'free-fluid',
      productId: 'fog-fluid',
      stockKind: 'consumable' as const,
      quantity: 2,
      maxQuantity: 5,
    },
  ];

  assert.equal(getCartLineAvailableMaximumQuantity(lines, lines[1]), 3);
  assert.equal(getCartLineAvailableMaximumQuantity(lines, lines[2]), 4);
});

test('leaves returnable stock allocation to the canonical server resolver', () => {
  const lines = [
    {
      lineId: 'small',
      productId: 'helmet',
      stockKind: 'returnable' as const,
      quantity: 1,
      maxQuantity: 2,
    },
    {
      lineId: 'large',
      productId: 'helmet',
      stockKind: 'returnable' as const,
      quantity: 1,
      maxQuantity: 3,
    },
  ];

  assert.equal(getCartLineAvailableMaximumQuantity(lines, lines[0]), 2);
  assert.equal(getCartLineAvailableMaximumQuantity(lines, lines[1]), 3);
});

test('limits the parent when another line uses required accessory stock', () => {
  const lines = [
    {
      lineId: 'parent',
      productId: 'smoke-machine',
      quantity: 1,
      maxQuantity: 5,
    },
    {
      lineId: 'required-fluid',
      parentLineId: 'parent',
      productId: 'fog-fluid',
      stockKind: 'consumable' as const,
      quantity: 1,
      maxQuantity: 5,
      requiredQuantity: 2,
    },
    {
      lineId: 'free-fluid',
      productId: 'fog-fluid',
      stockKind: 'consumable' as const,
      quantity: 1,
      maxQuantity: 5,
    },
  ];

  assert.equal(getCartLineAvailableMaximumQuantity(lines, lines[0]), 2);
  assert.equal(getCartLineAvailableMaximumQuantity(lines, lines[1]), 4);
});

test('reports when shared stock falls below a required child minimum', () => {
  const lines = [
    {
      lineId: 'parent',
      productId: 'smoke-machine',
      quantity: 2,
      maxQuantity: 5,
    },
    {
      lineId: 'required-fluid',
      parentLineId: 'parent',
      productId: 'fog-fluid',
      stockKind: 'consumable' as const,
      quantity: 2,
      maxQuantity: 2,
      requiredQuantity: 1,
    },
    {
      lineId: 'free-fluid',
      productId: 'fog-fluid',
      stockKind: 'consumable' as const,
      quantity: 1,
      maxQuantity: 2,
    },
  ];

  assert.equal(
    getCartLineAvailableMaximumQuantity(lines, lines[1]),
    1,
  );
});

test('groups required accessory lines under the line that owns them', () => {
  const groups = groupCartLinesByParent([
    { lineId: 'parent' },
    { lineId: 'child', parentLineId: 'parent' },
    { lineId: 'other' },
  ]);

  assert.deepEqual(
    groups.map((group) => group.line.lineId),
    ['parent', 'other'],
  );
  assert.deepEqual(
    groups[0].children.map((child) => child.lineId),
    ['child'],
  );
});

test('keeps an orphan child visible as a top-level line', () => {
  const groups = groupCartLinesByParent([
    { lineId: 'child', parentLineId: 'gone' },
  ]);

  assert.deepEqual(
    groups.map((group) => group.line.lineId),
    ['child'],
  );
});
