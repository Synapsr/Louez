import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRequiredAccessoryCartInputs,
  findBlockingRequiredAccessories,
  groupCartLinesByParent,
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
