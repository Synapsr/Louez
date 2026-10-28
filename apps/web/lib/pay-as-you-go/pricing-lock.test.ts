import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import type { Connection } from 'mysql2/promise';

// Database-backed: runs the real write paths against a THROWAWAY MySQL database migrated
// to the latest schema (`DATABASE_URL=<url> pnpm db:migrate:run`). Skipped unless
// PRICING_LOCK_TEST_DATABASE_URL is set. It writes to every subscription row, so never
// point it at a shared database.
const TEST_DATABASE_URL = process.env.PRICING_LOCK_TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.SKIP_ENV_VALIDATION = 'true';
  // The billing write paths only run on an instance that bills its stores.
  process.env.LOUEZ_BILLING = 'cloud';
  // The env offer for new stores. It differs from the built-in ladder and 15, so an
  // existing store that reads it by mistake is visible.
  process.env.PAYG_DEFAULT_PRICING = '{"flatRateCents":30}';
  process.env.PAYG_FREE_RESERVATIONS = '20';
}

const LATER_OFFER = { offer: { flatRateCents: 999 }, freeReservations: 0 };
const BACKFILL_OFFER = { offer: { flatRateCents: 40 }, freeReservations: 12 };

const run = randomUUID().replace(/-/g, '').slice(0, 9);
const storeId = (name: string) => `pl${run}${name}`.padEnd(21, '0').slice(0, 21);

interface Row {
  billing_mode: string;
  pricing_version: string | null;
  free_reservations_granted: number;
  config: { flatRateCents?: number | null; tiers?: unknown[] } | null;
}

describe('pricing lock (database)', { skip: !TEST_DATABASE_URL }, () => {
  let connection: Connection;
  let lock: typeof import('./pricing-lock');
  let core: typeof import('./pricing-lock-core');
  let subscriptionsLib: typeof import('@/lib/stripe/subscriptions');
  let metering: typeof import('./metering');
  let database: typeof import('@louez/db');

  const createdStores: string[] = [];

  async function addStore(name: string, currency = 'eur') {
    const id = storeId(name);
    createdStores.push(id);
    await connection.query(
      `INSERT INTO stores (id, user_id, name, slug, settings) VALUES (?, 'pricing-lock-test', ?, ?, ?)`,
      [id, `Pricing lock ${name}`, `${id.toLowerCase()}`, JSON.stringify({ currency })],
    );
    return id;
  }

  async function addRow(
    store: string,
    row: {
      billingMode?: string;
      config?: object | null;
      version?: string | null;
      free?: number;
      stripeSubscriptionId?: string | null;
    },
  ) {
    const id = randomUUID().replace(/-/g, '').slice(0, 21);
    await connection.query(
      `INSERT INTO subscriptions
         (id, store_id, plan_slug, billing_mode, pay_as_you_go_config, pricing_version,
          free_reservations_granted, stripe_subscription_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        store,
        row.billingMode === 'subscription' ? 'pro' : 'pay_as_you_go',
        row.billingMode ?? 'pay_as_you_go',
        row.config ? JSON.stringify(row.config) : null,
        row.version ?? null,
        row.free ?? 0,
        row.stripeSubscriptionId ?? null,
      ],
    );
    return id;
  }

  async function readRow(store: string): Promise<Row | undefined> {
    const [rows] = await connection.query(
      `SELECT billing_mode, pricing_version, free_reservations_granted,
              pay_as_you_go_config AS config
       FROM subscriptions WHERE store_id = ?`,
      [store],
    );
    return (rows as Row[])[0];
  }

  async function freeze(terms: typeof LATER_OFFER) {
    const plan = await lock.planLegacyPricingFreeze(connection);
    return lock.applyLegacyPricingFreeze(connection, plan, terms);
  }

  before(async () => {
    const mysql = await import('mysql2/promise');
    connection = await mysql.createConnection(TEST_DATABASE_URL ?? '');
    lock = await import('./pricing-lock');
    core = await import('./pricing-lock-core');
    subscriptionsLib = await import('@/lib/stripe/subscriptions');
    metering = await import('./metering');
    database = await import('@louez/db');
  });

  after(async () => {
    if (createdStores.length > 0) {
      await connection.query('DELETE FROM subscriptions WHERE store_id IN (?)', [createdStores]);
      await connection.query('DELETE FROM stores WHERE id IN (?)', [createdStores]);
    }
    await connection.end();
    await database.db.$client.end();
  });

  test('the backfill freezes every remaining store with the explicit terms, once', async () => {
    const legacy = await addStore('bflegacy');
    const subscribed = await addStore('bfsub');
    const orphanConfig = await addStore('bfnull');
    const noRow = await addStore('bfnorow', 'usd');
    await addRow(legacy, { config: null, version: null, free: 7 });
    await addRow(subscribed, { billingMode: 'subscription', config: null, version: null });
    await addRow(orphanConfig, { config: null, version: 'payg-ladder-v1', free: 5 });

    await freeze(BACKFILL_OFFER);

    const legacyRow = await readRow(legacy);
    assert.equal(legacyRow?.config?.flatRateCents, 40, 'the terms passed, not the env offer');
    assert.equal(legacyRow?.pricing_version, 'payg-ladder-v1');
    assert.equal(legacyRow?.free_reservations_granted, 7, 'an existing allowance is kept');
    assert.equal((await readRow(subscribed))?.config?.flatRateCents, 40, 'kept for a later switch');
    const frozen = await readRow(orphanConfig);
    assert.equal(frozen?.config?.flatRateCents, 40);
    assert.equal(frozen?.free_reservations_granted, 5);
    const created = await readRow(noRow);
    assert.equal(created?.config?.flatRateCents, 40);
    assert.equal(created?.billing_mode, 'pay_as_you_go');
    assert.equal(created?.pricing_version, 'payg-ladder-v1');
    assert.equal(created?.free_reservations_granted, 12);

    await freeze(LATER_OFFER);
    assert.deepEqual(await readRow(legacy), legacyRow);
    assert.deepEqual(await readRow(orphanConfig), frozen);
    assert.deepEqual(await readRow(noRow), created);
  });

  test('a stored partial config is spelled out without changing its prices', async () => {
    const partial = await addStore('partial');
    await addRow(partial, { config: { flatRateCents: 25 }, version: 'payg-ladder-v1', free: 1 });

    await freeze(LATER_OFFER);

    const row = await readRow(partial);
    assert.equal(row?.config?.flatRateCents, 25);
    assert.equal(row?.config?.tiers?.length, core.LEGACY_PAY_AS_YOU_GO_CONFIG.tiers?.length);
  });

  test('getStoreBilling never reads the env offer for an existing store', async () => {
    const frozen = await addStore('readfrozen');
    const unfrozen = await addStore('readnull');
    const noRow = await addStore('readnorow');
    await addRow(frozen, { config: { flatRateCents: 25 }, version: 'payg-ladder-v1', free: 4 });
    await addRow(unfrozen, { config: null, version: 'payg-ladder-v1', free: 2 });

    const a = await metering.getStoreBilling(frozen);
    assert.equal(a.config.flatRateCents, 25);
    assert.equal(a.freeReservationsGranted, 4);

    const b = await metering.getStoreBilling(unfrozen);
    assert.equal(b.config.flatRateCents, null, 'not the 30c env offer');
    assert.deepEqual(b.config.tiers, core.LEGACY_PAY_AS_YOU_GO_CONFIG.tiers);

    const c = await metering.getStoreBilling(noRow);
    assert.equal(c.billingMode, 'pay_as_you_go');
    assert.equal(c.config.flatRateCents, null);
    assert.equal(c.freeReservationsGranted, core.LEGACY_FREE_RESERVATIONS, 'not the env 20');
  });

  test('ensureSubscriptionRow writes the legacy terms only when the row is missing', async () => {
    const missing = await addStore('ensurenew');
    const present = await addStore('ensureold');
    await addRow(present, { config: { flatRateCents: 25 }, version: 'payg-custom', free: 9 });
    const before = await readRow(present);

    await lock.ensureSubscriptionRow(database.db, missing);
    await lock.ensureSubscriptionRow(database.db, present);

    const created = await readRow(missing);
    assert.equal(created?.config?.flatRateCents, null);
    assert.equal(created?.free_reservations_granted, core.LEGACY_FREE_RESERVATIONS);
    assert.equal(created?.pricing_version, 'payg-ladder-v1');
    assert.deepEqual(await readRow(present), before);
  });

  test('switching to pay-as-you-go keeps the pricing', async () => {
    const store = await addStore('switch');
    await addRow(store, {
      billingMode: 'subscription',
      config: { flatRateCents: 25, tiers: [] },
      version: 'payg-custom',
      free: 6,
    });
    const before = await readRow(store);

    assert.deepEqual(await subscriptionsLib.switchToPayAsYouGo(store), { mode: 'immediate' });

    const after = await readRow(store);
    assert.equal(after?.billing_mode, 'pay_as_you_go');
    assert.deepEqual(
      { ...after, billing_mode: before?.billing_mode },
      before,
      'only the billing mode changed',
    );
  });

  test('an ended subscription returns to pay-as-you-go with the same pricing', async () => {
    const store = await addStore('ended');
    const rowId = await addRow(store, {
      billingMode: 'subscription',
      config: { flatRateCents: 25, tiers: [] },
      version: 'payg-ladder-v1',
      free: 8,
      stripeSubscriptionId: `sub_${store}`,
    });
    const before = await readRow(store);

    await subscriptionsLib.endSubscriptionToPayAsYouGo(rowId);

    const after = await readRow(store);
    assert.equal(after?.billing_mode, 'pay_as_you_go');
    assert.deepEqual({ ...after, billing_mode: before?.billing_mode }, before);
  });

  test('buying a plan keeps the pay-as-you-go pricing for later', async () => {
    const withRow = await addStore('planrow');
    const withoutRow = await addStore('plannorow');
    await addRow(withRow, { config: { flatRateCents: 25, tiers: [] }, version: 'payg-ladder-v1' });
    const before = await readRow(withRow);
    const plan = (store: string) => ({
      storeId: store,
      planSlug: 'pro',
      stripeSubscriptionId: `sub_${store}`,
      stripeCustomerId: `cus_${store}`,
      status: 'active' as const,
      currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
    });

    await subscriptionsLib.activatePlanSubscription(plan(withRow));
    await subscriptionsLib.activatePlanSubscription(plan(withoutRow));

    const after = await readRow(withRow);
    assert.equal(after?.billing_mode, 'subscription');
    assert.deepEqual(after?.config, before?.config);
    assert.equal(after?.pricing_version, before?.pricing_version);
    const created = await readRow(withoutRow);
    assert.equal(created?.billing_mode, 'subscription');
    assert.equal(created?.config?.flatRateCents, null, 'the legacy ladder, not the env offer');
    assert.equal(created?.free_reservations_granted, core.LEGACY_FREE_RESERVATIONS);
  });

  test('referral rewards only change the free-reservation allowance', async () => {
    const referrer = await addStore('referrer');
    const legacyReferrer = await addStore('referrernorow');
    const referred = await addStore('referred');
    await addRow(referrer, { config: { flatRateCents: 25, tiers: [] }, version: 'payg-custom', free: 10 });
    await addRow(referred, { config: { flatRateCents: 25, tiers: [] }, version: 'payg-ladder-v1', free: 15 });
    const referrerBefore = await readRow(referrer);
    const referredBefore = await readRow(referred);

    await lock.addFreeReservations(database.db, referrer, 30);
    await lock.addFreeReservations(database.db, legacyReferrer, 30);
    await lock.raiseFreeReservations(database.db, referred, 30);

    assert.deepEqual(await readRow(referrer), { ...referrerBefore, free_reservations_granted: 40 });
    assert.deepEqual(await readRow(referred), { ...referredBefore, free_reservations_granted: 30 });
    const created = await readRow(legacyReferrer);
    assert.equal(created?.config?.flatRateCents, null, 'the legacy ladder, not the env offer');
    assert.equal(created?.free_reservations_granted, core.LEGACY_FREE_RESERVATIONS + 30);
  });
});
