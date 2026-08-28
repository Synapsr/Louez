import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAccountDeletionConfirmationFragment,
  parseAccountDeletionReason,
} from './account-deletion'

test('accepts only known account deletion reasons', () => {
  assert.equal(parseAccountDeletionReason('missing_features'), 'missing_features')
  assert.equal(parseAccountDeletionReason('custom free text'), null)
  assert.equal(parseAccountDeletionReason(null), null)
})

test('adds an optional reason to the confirmation fragment', () => {
  assert.equal(
    buildAccountDeletionConfirmationFragment('token-value', 'too_expensive'),
    'token=token-value&reason=too_expensive',
  )
  assert.equal(
    buildAccountDeletionConfirmationFragment('token-value', null),
    'token=token-value',
  )
})
