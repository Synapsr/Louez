import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_COMBINATION_KEY, isPooledCombinationKey } from './variants'

const axes = [{ key: 'taille', label: 'Taille', position: 0 }]

test('a default-combination line on a product with axes is pooled', () => {
  assert.equal(isPooledCombinationKey(axes, DEFAULT_COMBINATION_KEY), true)
})

test('a line with a combination, or on a product without axes, is not pooled', () => {
  assert.equal(isPooledCombinationKey(axes, 'taille:M'), false)
  assert.equal(isPooledCombinationKey([], DEFAULT_COMBINATION_KEY), false)
  assert.equal(isPooledCombinationKey(null, DEFAULT_COMBINATION_KEY), false)
  assert.equal(isPooledCombinationKey(axes, null), false)
})
