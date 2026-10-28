import { type SQL, eq, sql } from 'drizzle-orm';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { nanoid } from 'nanoid';

import type { Database, Transaction } from '@louez/db';
import {
  billingMarkStatement,
  isBillingSyncEnabled,
  markLegacyStore,
} from '@louez/db/billing-queue';
import { stores, subscriptions } from '@louez/db/schema';
import type { PayAsYouGoConfig } from '@louez/types';

import { isBillingEnabled } from '@/lib/billing/mode';

import {
  PAYG_LADDER_V1,
  buildExistingStorePricing,
  buildFrozenPayAsYouGoConfig,
  normalizeCurrency,
} from './pricing-lock-core';

/**
 * Database side of the pricing lock (see pricing-lock-core.ts).
 *
 * The freeze uses raw SQL on purpose: the cloud backfill runs it BEFORE migration 0081
 * adds `pricing_version`, and Drizzle inserts list every column of the schema. It takes
 * an explicit connection and never imports the app's `db`, so scripts can point it at
 * MIGRATE_DATABASE_URL. For the same reason it imports the billing marks from their own
 * entry point, not from `@louez/db`. Every write to a subscription row marks the store's
 * legacy_store snapshot for the billing service (louez-billing docs/api, README §5.2).
 */

/** What a never-frozen store was paying before the lock, written onto its row once. */
export interface LegacyPricingTerms {
  offer: PayAsYouGoConfig;
  freeReservations: number;
}

export interface PlannedRowFreeze {
  subscriptionId: string;
  storeId: string;
  /** Null when the row's store no longer exists. */
  storeSlug: string | null;
  currency: string;
  /** The row's pricing version, null on legacy rows. */
  pricingVersion: string | null;
}

export interface PlannedRowCreation {
  storeId: string;
  storeSlug: string;
  currency: string;
}

export interface PlannedRowNormalization {
  subscriptionId: string;
  storeId: string;
  /** The stored JSON, matched again at write time so a concurrent edit is never overwritten. */
  storedConfig: PayAsYouGoConfig;
  /** Same prices, every tier written out, so the row no longer depends on a code default. */
  literalConfig: PayAsYouGoConfig;
}

export interface LegacyPricingFreezePlan {
  /** False before migration 0081: version columns are then left to the migration. */
  hasPricingVersion: boolean;
  /** Rows that have a config but no version (old code wrote them after the migration). */
  rowsToTag: number;
  rowsToNormalize: PlannedRowNormalization[];
  rowsToFreeze: PlannedRowFreeze[];
  storesToCreate: PlannedRowCreation[];
}

export interface PricingFreezeResult {
  tagged: number;
  normalized: number;
  frozen: number;
  created: number;
}

/** True when the plan has nothing to write. */
export function isEmptyFreezePlan(plan: LegacyPricingFreezePlan): boolean {
  return (
    plan.rowsToTag === 0 &&
    plan.rowsToNormalize.length === 0 &&
    plan.rowsToFreeze.length === 0 &&
    plan.storesToCreate.length === 0
  );
}

type Rows = Record<string, unknown>[];

async function select(connection: Connection, sql: string, values: unknown[] = []): Promise<Rows> {
  const [rows] = await connection.query<RowDataPacket[]>(sql, values);
  return rows;
}

async function execute(connection: Connection, sql: string, values: unknown[] = []): Promise<number> {
  const [header] = await connection.query<ResultSetHeader>(sql, values);
  return header.affectedRows;
}

/** Whether migration 0081 has run on this database. */
export async function hasPricingVersionColumn(connection: Connection): Promise<boolean> {
  const [row] = await select(
    connection,
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions' AND COLUMN_NAME = 'pricing_version'`,
  );
  return Number(row?.n) > 0;
}

/** A store's commission currency from its raw `stores.settings` JSON (object or string). */
export function currencyOfSettings(settings: unknown): string {
  const parsed = typeof settings === 'string' ? safeJson(settings) : settings;
  const currency =
    parsed && typeof parsed === 'object' && 'currency' in parsed ? parsed.currency : null;
  return normalizeCurrency(typeof currency === 'string' ? currency : null);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseStoredConfig(value: unknown): PayAsYouGoConfig | null {
  const parsed = typeof value === 'string' ? safeJson(value) : value;
  return parsed && typeof parsed === 'object' ? (parsed as PayAsYouGoConfig) : null;
}

/** Whether a stored config already spells out its flat rate and every tier. */
function isLiteralConfig(stored: PayAsYouGoConfig, literal: PayAsYouGoConfig): boolean {
  const prices = (config: PayAsYouGoConfig) =>
    JSON.stringify({
      flatRateCents: config.flatRateCents === undefined ? 'missing' : config.flatRateCents,
      tiers: (config.tiers ?? []).map((t) => [t.upToCount, t.priceCents]),
    });
  return prices(stored) === prices(literal);
}

/**
 * List what the freeze would change. Read-only. It reaches the stores that never had
 * frozen pricing: rows without a config (written before the lock, by older code still
 * running during an upgrade, or by a write bug or manual SQL) and stores without a row.
 * New code always writes a config and a version, so nothing else ever matches. Only the
 * backfill script (`payg:freeze-pricing`) runs it, with terms the operator passes.
 */
export async function planLegacyPricingFreeze(
  connection: Connection,
): Promise<LegacyPricingFreezePlan> {
  const hasPricingVersion = await hasPricingVersionColumn(connection);

  const [tagRow] = hasPricingVersion
    ? await select(
        connection,
        `SELECT COUNT(*) AS n FROM subscriptions
         WHERE pricing_version IS NULL AND pay_as_you_go_config IS NOT NULL`,
      )
    : [{ n: 0 }];

  const stored = await select(
    connection,
    `SELECT id, store_id, pay_as_you_go_config AS config FROM subscriptions
     WHERE pay_as_you_go_config IS NOT NULL ORDER BY id`,
  );
  const rowsToNormalize = stored.flatMap((row) => {
    const storedConfig = parseStoredConfig(row.config);
    if (!storedConfig) return [];
    const literalConfig = buildFrozenPayAsYouGoConfig(storedConfig, storedConfig.currency ?? '');
    return isLiteralConfig(storedConfig, literalConfig)
      ? []
      : [
          {
            subscriptionId: String(row.id),
            storeId: String(row.store_id),
            storedConfig,
            literalConfig,
          },
        ];
  });

  const versionColumn = hasPricingVersion ? 'sub.pricing_version' : 'NULL';
  const rows = await select(
    connection,
    `SELECT sub.id, sub.store_id, ${versionColumn} AS pricing_version, st.slug, st.settings
     FROM subscriptions sub LEFT JOIN stores st ON st.id = sub.store_id
     WHERE sub.pay_as_you_go_config IS NULL
     ORDER BY sub.created_at, sub.id`,
  );

  const missing = await select(
    connection,
    `SELECT st.id, st.slug, st.settings
     FROM stores st LEFT JOIN subscriptions sub ON sub.store_id = st.id
     WHERE sub.id IS NULL
     ORDER BY st.created_at, st.id`,
  );

  return {
    hasPricingVersion,
    rowsToTag: Number(tagRow?.n) || 0,
    rowsToNormalize,
    rowsToFreeze: rows.map((row) => ({
      subscriptionId: String(row.id),
      storeId: String(row.store_id),
      storeSlug: row.slug === null || row.slug === undefined ? null : String(row.slug),
      currency: currencyOfSettings(row.settings),
      pricingVersion:
        row.pricing_version === null || row.pricing_version === undefined
          ? null
          : String(row.pricing_version),
    })),
    storesToCreate: missing.map((store) => ({
      storeId: String(store.id),
      storeSlug: String(store.slug),
      currency: currencyOfSettings(store.settings),
    })),
  };
}

/** Whether migration 0085 (the billing queue) has run on this database. */
async function hasBillingQueueTable(connection: Connection): Promise<boolean> {
  const [row] = await select(
    connection,
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_sync_queue'`,
  );
  return Number(row?.n) > 0;
}

/**
 * Apply a plan in one transaction. Every statement re-checks that the row still has no
 * config (or that the store still has no row), so a plan applied twice, or concurrently,
 * changes nothing the second time. Each store whose row changed gets its legacy_store
 * mark in the same transaction; the scripts may run before migration 0085, so no mark is
 * written without the queue table.
 */
export async function applyLegacyPricingFreeze(
  connection: Connection,
  plan: LegacyPricingFreezePlan,
  terms: LegacyPricingTerms,
): Promise<PricingFreezeResult> {
  const result: PricingFreezeResult = { tagged: 0, normalized: 0, frozen: 0, created: 0 };
  if (isEmptyFreezePlan(plan)) return result;
  const version = plan.hasPricingVersion;
  const changedStores = new Set<string>();

  await connection.beginTransaction();
  try {
    const marking = isBillingSyncEnabled() && (await hasBillingQueueTable(connection));

    if (version && plan.rowsToTag > 0) {
      const untagged = `pricing_version IS NULL AND pay_as_you_go_config IS NOT NULL`;
      if (marking) {
        const rows = await select(
          connection,
          `SELECT store_id FROM subscriptions WHERE ${untagged} FOR UPDATE`,
        );
        for (const row of rows) changedStores.add(String(row.store_id));
      }
      result.tagged = await execute(
        connection,
        `UPDATE subscriptions SET pricing_version = ? WHERE ${untagged}`,
        [PAYG_LADDER_V1],
      );
    }

    for (const row of plan.rowsToNormalize) {
      const changed = await execute(
        connection,
        `UPDATE subscriptions SET pay_as_you_go_config = CAST(? AS JSON), updated_at = NOW()
         WHERE id = ? AND pay_as_you_go_config = CAST(? AS JSON)`,
        [
          JSON.stringify(row.literalConfig),
          row.subscriptionId,
          JSON.stringify(row.storedConfig),
        ],
      );
      result.normalized += changed;
      if (changed > 0) changedStores.add(row.storeId);
    }

    // An existing row keeps its stored allowance: only stores without a row followed
    // PAYG_FREE_RESERVATIONS live.
    for (const row of plan.rowsToFreeze) {
      const config = JSON.stringify(buildFrozenPayAsYouGoConfig(terms.offer, row.currency));
      const changed = await execute(
        connection,
        `UPDATE subscriptions
         SET pay_as_you_go_config = CAST(? AS JSON),
             ${version ? 'pricing_version = ?,' : ''}
             updated_at = NOW()
         WHERE id = ? AND pay_as_you_go_config IS NULL`,
        [config, ...(version ? [PAYG_LADDER_V1] : []), row.subscriptionId],
      );
      result.frozen += changed;
      if (changed > 0) changedStores.add(row.storeId);
    }

    for (const store of plan.storesToCreate) {
      const config = JSON.stringify(buildFrozenPayAsYouGoConfig(terms.offer, store.currency));
      // affectedRows is 1 for an insert and 0 when ON DUPLICATE KEY found a row.
      const created = await execute(
        connection,
        `INSERT INTO subscriptions
           (id, store_id, plan_slug, billing_mode, pay_as_you_go_config,
            ${version ? 'pricing_version,' : ''} free_reservations_granted)
         VALUES (?, ?, 'pay_as_you_go', 'pay_as_you_go', CAST(? AS JSON),
            ${version ? '?,' : ''} ?)
         ON DUPLICATE KEY UPDATE store_id = store_id`,
        [
          nanoid(),
          store.storeId,
          config,
          ...(version ? [PAYG_LADDER_V1] : []),
          terms.freeReservations,
        ],
      );
      result.created += created;
      if (created > 0) changedStores.add(store.storeId);
    }

    const mark = marking
      ? billingMarkStatement(
          [...changedStores].map((storeId) => ({
            type: 'legacy_store' as const,
            aggregateId: storeId,
            storeId,
          })),
        )
      : null;
    if (mark) await connection.query(mark.sql, mark.params);

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  return result;
}

export interface UnfrozenPricingCounts {
  rowsWithoutConfig: number;
  /** Null before migration 0081. */
  rowsWithoutVersion: number | null;
  storesWithoutRow: number;
  /** Subscription rows whose store no longer exists. */
  orphanRows: number;
}

/** What is left to lock. Zero rows without config and zero stores without row = done. */
export async function countUnfrozenPricing(connection: Connection): Promise<UnfrozenPricingCounts> {
  const version = await hasPricingVersionColumn(connection);
  const [counts] = await select(
    connection,
    `SELECT
       (SELECT COUNT(*) FROM subscriptions WHERE pay_as_you_go_config IS NULL) AS without_config,
       ${version ? '(SELECT COUNT(*) FROM subscriptions WHERE pricing_version IS NULL)' : 'NULL'} AS without_version,
       (SELECT COUNT(*) FROM stores st LEFT JOIN subscriptions sub ON sub.store_id = st.id WHERE sub.id IS NULL) AS without_row,
       (SELECT COUNT(*) FROM subscriptions sub LEFT JOIN stores st ON st.id = sub.store_id WHERE st.id IS NULL) AS orphans`,
  );
  const nullable = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    rowsWithoutConfig: Number(counts.without_config),
    rowsWithoutVersion: nullable(counts.without_version),
    storesWithoutRow: Number(counts.without_row),
    orphanRows: Number(counts.orphans),
  };
}

type Executor = Database | Transaction;

/**
 * Inserts the missing row of an existing store with exactly the pricing the store already
 * resolves to. True when it inserted one.
 */
async function insertMissingRow(tx: Transaction, storeId: string): Promise<boolean> {
  const [existing] = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.storeId, storeId))
    .limit(1);
  if (existing) return false;

  const [store] = await tx
    .select({ settings: stores.settings })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) return false;
  const [inserted] = await tx
    .insert(subscriptions)
    .values({
      id: nanoid(),
      storeId,
      planSlug: 'pay_as_you_go',
      billingMode: 'pay_as_you_go',
      ...buildExistingStorePricing(normalizeCurrency(store.settings?.currency)),
    })
    .onDuplicateKeyUpdate({ set: { storeId: sql`${subscriptions.storeId}` } });
  return inserted.affectedRows === 1;
}

/**
 * Make sure an EXISTING store has a subscription row before a write path updates it.
 * A missing row is created with exactly the pricing the store already resolves to
 * (`buildExistingStorePricing`), so callers only ever update their own columns and never
 * change what the store pays. Concurrent callers are safe (unique store_id). Creates
 * nothing when platform billing is off: such an instance writes no billing rows. Inside
 * the caller's transaction it runs in a savepoint.
 */
export async function ensureSubscriptionRow(executor: Executor, storeId: string): Promise<void> {
  if (!isBillingEnabled()) return;
  await executor.transaction(async (tx) => {
    if (await insertMissingRow(tx, storeId)) await markLegacyStore(tx, storeId);
  });
}

/** Writes the allowance, creating a missing row first, and marks the store. */
async function writeFreeReservations(
  executor: Executor,
  storeId: string,
  granted: SQL,
): Promise<void> {
  if (!isBillingEnabled()) return;
  await executor.transaction(async (tx) => {
    await insertMissingRow(tx, storeId);
    await tx
      .update(subscriptions)
      .set({ freeReservationsGranted: granted, updatedAt: new Date() })
      .where(eq(subscriptions.storeId, storeId));
    await markLegacyStore(tx, storeId);
  });
}

/**
 * Add free reservations to an existing store (referral reward for the Referrer). Only the
 * allowance changes; a missing row is created first with the pricing the store already
 * pays. No-op when platform billing is off.
 */
export async function addFreeReservations(
  executor: Executor,
  storeId: string,
  count: number,
): Promise<void> {
  await writeFreeReservations(
    executor,
    storeId,
    sql`${subscriptions.freeReservationsGranted} + ${count}`,
  );
}

/**
 * Raise an existing store's allowance to at least `count` (welcome reward of a Referred
 * Store that finishes onboarding). Only the allowance changes; a missing row is created
 * first with the pricing the store already pays. No-op when platform billing is off.
 */
export async function raiseFreeReservations(
  executor: Executor,
  storeId: string,
  count: number,
): Promise<void> {
  await writeFreeReservations(
    executor,
    storeId,
    sql`GREATEST(${subscriptions.freeReservationsGranted}, ${count})`,
  );
}
