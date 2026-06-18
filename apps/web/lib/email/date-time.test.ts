import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatEmailDateInStoreTimezone,
  resolveStoreTimezone,
} from './date-time'

test('formats email dates in the explicit store timezone', () => {
  const selectedParisTime = new Date('2026-06-18T08:00:00.000Z')

  assert.equal(
    formatEmailDateInStoreTimezone(
      selectedParisTime,
      'fr',
      'HH:mm',
      'Europe/Paris',
    ),
    '10:00',
  )
})

test('falls back to the store country timezone before UTC', () => {
  assert.equal(resolveStoreTimezone(null, 'FR'), 'Europe/Paris')
  assert.equal(resolveStoreTimezone(null, null), 'UTC')
})
