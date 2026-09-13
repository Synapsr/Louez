import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertCopiedRows,
  copySignInIdentity,
  parseArgs,
  registerIdMap,
  transformDataset,
} from './store-clone'

test('copies AI balances and history while detaching automatic billing and call access', () => {
  const dataset = {
    stores: [{ id: 'store' }],
    ai_credits: [
      { id: 'balance', store_id: 'store', balance_micro: 1000, auto_topup_enabled: 1 },
    ],
    ai_credit_transactions: [
      {
        id: 'txn',
        store_id: 'store',
        dedup_key: 'purchase',
        stripe_payment_intent_id: 'pi_test',
        credits_micro: 1000,
      },
    ],
    ai_advisor_conversations: [
      {
        id: 'conversation',
        store_id: 'store',
        customer_id: null,
        reservation_id: null,
        provider_call_id: 'call',
        recording_sid: 'recording',
      },
    ],
    ai_advisor_messages: [
      {
        id: 'message',
        store_id: 'store',
        conversation_id: 'conversation',
        content: 'Example message',
      },
    ],
    ai_credit_debits: [
      {
        id: 'debit',
        store_id: 'store',
        conversation_id: 'conversation',
        dedup_key: 'usage',
        debited_micro: 10,
      },
    ],
  }
  const idMaps = registerIdMap(dataset, 'store', 'copy')
  const result = transformDataset(dataset, {
    scope: 'full',
    sourceStoreId: 'store',
    targetStoreId: 'copy',
    targetStoreSlug: 'copy',
    targetStoreName: 'Copy',
    ownerUserId: 'owner',
    idMaps,
  })
  assert.deepEqual(result.skippedByTable, {})
  assert.equal(result.rows.ai_credits?.[0]?.balance_micro, 1000)
  assert.equal(result.rows.ai_credits?.[0]?.auto_topup_enabled, false)
  assert.equal(result.rows.ai_credit_transactions?.[0]?.stripe_payment_intent_id, null)
  assert.equal(result.rows.ai_advisor_conversations?.[0]?.provider_call_id, null)
  assert.equal(result.rows.ai_advisor_conversations?.[0]?.recording_sid, null)
  assert.equal(
    result.rows.ai_advisor_messages?.[0]?.conversation_id,
    result.rows.ai_advisor_conversations?.[0]?.id,
  )
  assert.equal(
    result.rows.ai_credit_debits?.[0]?.conversation_id,
    result.rows.ai_advisor_conversations?.[0]?.id,
  )
  assert.notEqual(result.rows.ai_credit_debits?.[0]?.dedup_key, 'usage')
})

test('rejects malformed options instead of silently cloning the wrong scope', () => {
  assert.throws(() => parseArgs(['--scope', 'everything']))
  assert.throws(() => parseArgs(['--aply']))
  assert.throws(() => parseArgs(['--source-user-email', 'invalid']))
  assert.throws(() => parseArgs(['--source-store-id', '--apply']))
  assert.throws(() => parseArgs(['--source-store-id']))
  assert.throws(() =>
    parseArgs(['--source-user-email', 'test@example.com', '--owner-user-id', 'other']),
  )
})

test('verifies round-trip contents and rejects missing or truncated data', () => {
  assertCopiedRows(
    'example',
    [{ id: 'one', enabled: true, settings: { a: 1, b: 2 } }],
    [{ id: 'one', enabled: 1, settings: { b: 2, a: 1 }, extra_default: null }],
  )
  assert.throws(() => assertCopiedRows('example', [{ id: 'one' }], []))
  assert.throws(() =>
    assertCopiedRows(
      'example',
      [{ id: 'one', text: 'original' }],
      [{ id: 'one', text: 'orig' }],
    ),
  )
})

test('preserves sign-in identity and password hash without reusing live OAuth tokens', () => {
  const source = {
    id: 'account',
    user_id: 'user',
    provider: 'google',
    provider_account_id: 'google-user',
    password: 'test-hash',
    access_token: 'test-access',
    refresh_token: 'test-refresh',
    id_token: 'test-id',
    access_token_expires_at: new Date(),
    refresh_token_expires_at: new Date(),
  }
  const result = copySignInIdentity(source)
  assert.equal(result.password, source.password)
  assert.equal(result.provider_account_id, source.provider_account_id)
  assert.equal(result.user_id, source.user_id)
  assert.equal(result.access_token, null)
  assert.equal(result.refresh_token, null)
  assert.equal(result.id_token, null)
  assert.equal(source.access_token, 'test-access')
})

test('copies roles, variants, deleted-unit snapshots and historical stats without losing rows', () => {
  const dataset = {
    stores: [
      {
        id: 'store',
        user_id: 'owner',
        slug: 'shop',
        name: 'Shop',
        stripe_account_id: 'acct_test',
        settings: { reservationMode: 'payment' },
        notification_settings: { reservation_reminder_pickup: { email: true } },
      },
    ],
    store_members: [
      {
        id: 'member',
        store_id: 'store',
        user_id: 'client',
        member_role: 'member',
        added_by: 'owner',
      },
    ],
    variant_definitions: [{ id: 'axis', store_id: 'store', key: 'size' }],
    variant_values: [{ id: 'value', definition_id: 'axis', label: 'M' }],
    products: [{ id: 'product', store_id: 'store', category_id: null }],
    product_units: [{ id: 'unit', product_id: 'product' }],
    customers: [{ id: 'customer', store_id: 'store' }],
    reservations: [
      {
        id: 'reservation',
        store_id: 'store',
        customer_id: 'customer',
        stripe_customer_id: 'cus_test',
      },
    ],
    reservation_items: [
      { id: 'item', reservation_id: 'reservation', product_id: 'product' },
    ],
    reservation_item_units: [
      {
        id: 'allocation',
        reservation_item_id: 'item',
        product_unit_id: null,
        identifier_snapshot: 'Retired bicycle',
      },
    ],
    product_stats: [
      { id: 'stat', store_id: 'store', product_id: 'deleted-product', views: 9 },
    ],
    product_unit_events: [
      { id: 'event', store_id: 'store', product_unit_id: null, actor_user_id: 'client' },
    ],
  }
  const idMaps = registerIdMap(dataset, 'store', 'store', true)
  const result = transformDataset(dataset, {
    scope: 'full',
    sourceStoreId: 'store',
    targetStoreId: 'store',
    targetStoreSlug: 'shop',
    targetStoreName: 'Shop',
    ownerUserId: 'owner',
    idMaps,
  })
  assert.deepEqual(result.skippedByTable, {})
  assert.deepEqual(result.rows.store_members, dataset.store_members)
  assert.deepEqual(result.rows.variant_values, dataset.variant_values)
  assert.deepEqual(result.rows.reservation_item_units, dataset.reservation_item_units)
  assert.deepEqual(result.rows.product_stats, dataset.product_stats)
  assert.deepEqual(result.rows.product_unit_events, dataset.product_unit_events)
  assert.equal(result.rows.stores?.[0]?.stripe_account_id, null)
  assert.equal(result.rows.reservations?.[0]?.stripe_customer_id, null)
  assert.deepEqual(result.rows.stores?.[0]?.settings, { reservationMode: 'payment' })
  const notifications = result.rows.stores?.[0]?.notification_settings as Record<
    string,
    Record<string, boolean>
  >
  assert.equal(notifications.reservation_reminder_pickup?.email, false)
})

test('regenerating IDs remaps new location, promo, variant and downtime references', () => {
  const dataset = {
    stores: [{ id: 'store' }],
    store_locations: [{ id: 'location', store_id: 'store' }],
    promo_codes: [{ id: 'promo', store_id: 'store' }],
    variant_definitions: [{ id: 'axis', store_id: 'store' }],
    variant_values: [{ id: 'value', definition_id: 'axis' }],
    products: [{ id: 'product', store_id: 'store' }],
    product_units: [{ id: 'unit', product_id: 'product' }],
    product_unit_downtimes: [
      { id: 'downtime', store_id: 'store', product_unit_id: 'unit' },
    ],
    customers: [{ id: 'customer', store_id: 'store' }],
    reservations: [
      {
        id: 'reservation',
        store_id: 'store',
        customer_id: 'customer',
        pickup_location_id: 'location',
        return_location_id: 'location',
        promo_code_id: 'promo',
      },
    ],
  }
  const idMaps = registerIdMap(dataset, 'store', 'copy')
  const result = transformDataset(dataset, {
    scope: 'full',
    sourceStoreId: 'store',
    targetStoreId: 'copy',
    targetStoreSlug: 'copy',
    targetStoreName: 'Copy',
    ownerUserId: 'owner',
    idMaps,
  })
  assert.deepEqual(result.skippedByTable, {})
  assert.equal(result.rows.store_members?.[0]?.member_role, 'owner')
  assert.notEqual(result.rows.variant_values?.[0]?.definition_id, 'axis')
  assert.equal(
    result.rows.variant_values?.[0]?.definition_id,
    result.rows.variant_definitions?.[0]?.id,
  )
  assert.equal(
    result.rows.product_unit_downtimes?.[0]?.product_unit_id,
    result.rows.product_units?.[0]?.id,
  )
  assert.equal(
    result.rows.reservations?.[0]?.pickup_location_id,
    result.rows.store_locations?.[0]?.id,
  )
  assert.equal(
    result.rows.reservations?.[0]?.promo_code_id,
    result.rows.promo_codes?.[0]?.id,
  )
})
