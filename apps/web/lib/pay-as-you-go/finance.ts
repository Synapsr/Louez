import { desc, inArray, sql } from 'drizzle-orm';

import { db } from '@louez/db';
import { platformFees, stores, subscriptions } from '@louez/db';
import type { BillingMode } from '@louez/types';

import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin';

import { billingMonthOf } from './metering';

/**
 * Hard authorization guard for every cross-store finance read. These functions expose
 * ALL stores' fee data, so they must never run for a non-admin even if a caller forgets
 * the route guard. Defense-in-depth alongside the /admin layout.
 */
async function assertPlatformAdmin(): Promise<void> {
  if (!(await isCurrentUserPlatformAdmin())) {
    throw new Error('Unauthorized: platform admin required');
  }
}

/**
 * Platform finance read model (platform-admin only).
 *
 * Aggregates the `platform_fee` ledger into the figures the platform needs to see its
 * own revenue from the pay-as-you-go reservation commission, split by realized vs owed,
 * per month and per store. (With Stripe Standard accounts there is no separate platform
 * payment fee — the connected account bears Stripe's processing fees.)
 *
 * "Margin" here is gross reservation-commission revenue (collected/billed, net of
 * refunds) — Stripe's own processing cost is borne by the connected account, not the
 * platform.
 *
 * Amounts are aggregated for a single currency (the platform's primary currency) to avoid
 * summing across currencies; `currencies` lists every currency present so the page can flag
 * the rare multi-currency case.
 */

type FeeStatus = 'pending' | 'collected' | 'billed' | 'voided' | 'reversed';
type FeeSource = 'online' | 'manual' | 'free';

export interface FinanceBucket {
  /** Realized reservation-commission revenue (collected/billed, net of refunds). */
  realizedCents: number;
  /** Reservation fees owed but not yet billed (manual, pending month-end invoice). */
  pendingCents: number;
  /** Fees reversed on refunds/disputes (excluded from realized revenue). */
  reversedCents: number;
  /** Number of realized billable rentals (paid reservation fees). */
  reservationCount: number;
  /** Number of free (waived) rentals gifted via the welcome allowance. */
  freeCount: number;
}

export interface FinanceMonth extends FinanceBucket {
  billingMonth: string;
}

export interface FinanceStore extends FinanceBucket {
  storeId: string;
  storeName: string;
  billingMode: BillingMode;
}

export interface PlatformFinance {
  /** Current billing month (`YYYY-MM`, UTC). */
  currentMonth: string;
  /** Currency used for all amounts below. */
  currency: string;
  /** Every currency present in the ledger (to flag multi-currency setups). */
  currencies: string[];
  /** All-time totals. */
  overall: FinanceBucket;
  /** Totals for the current billing month. */
  thisMonth: FinanceBucket;
  /** Per-month totals, newest first. */
  byMonth: FinanceMonth[];
  /** Per-store totals, highest realized revenue first. */
  byStore: FinanceStore[];
}

interface GroupedRow {
  storeId: string;
  billingMonth: string;
  source: FeeSource;
  status: FeeStatus;
  currency: string;
  totalCents: number;
  reversedCents: number;
  count: number;
}

function emptyBucket(): FinanceBucket {
  return {
    realizedCents: 0,
    pendingCents: 0,
    reversedCents: 0,
    reservationCount: 0,
    freeCount: 0,
  };
}

/** Fold one grouped ledger row into a running bucket. */
function fold(bucket: FinanceBucket, row: GroupedRow): void {
  // Waived (free welcome-allowance) rentals: count them, but they carry no revenue.
  if (row.source === 'free') {
    if (row.status !== 'voided') bucket.freeCount += row.count;
    return;
  }
  if (row.status === 'collected' || row.status === 'billed') {
    // Net of any PARTIAL refund still sitting on a collected/billed row.
    const net = Math.max(0, row.totalCents - row.reversedCents);
    bucket.realizedCents += net;
    bucket.reservationCount += row.count;
    bucket.reversedCents += row.reversedCents;
  } else if (row.status === 'pending') {
    bucket.pendingCents += row.totalCents;
    bucket.reservationCount += row.count;
  } else if (row.status === 'reversed') {
    // Fully reversed rows: the whole amount is reversed, nothing realized.
    bucket.reversedCents += row.totalCents;
  }
  // 'voided' rows never count toward revenue.
}

/**
 * Build the platform-wide finance summary from the `platform_fee` ledger.
 * One grouped query over the ledger; store metadata fetched once for the stores that appear.
 */
export async function getPlatformFinance(
  reference: Date = new Date(),
): Promise<PlatformFinance> {
  await assertPlatformAdmin();
  const currentMonth = billingMonthOf(reference);

  const rows = (await db
    .select({
      storeId: platformFees.storeId,
      billingMonth: platformFees.billingMonth,
      source: platformFees.source,
      status: platformFees.status,
      currency: platformFees.currency,
      totalCents: sql<number>`sum(${platformFees.amountCents})`,
      reversedCents: sql<number>`sum(${platformFees.amountReversedCents})`,
      count: sql<number>`count(*)`,
    })
    .from(platformFees)
    .groupBy(
      platformFees.storeId,
      platformFees.billingMonth,
      platformFees.source,
      platformFees.status,
      platformFees.currency,
    )) as Array<{
    storeId: string;
    billingMonth: string;
    source: FeeSource;
    status: FeeStatus;
    currency: string;
    totalCents: number | string;
    reversedCents: number | string;
    count: number | string;
  }>;

  const normalized: GroupedRow[] = rows.map((r) => ({
    storeId: r.storeId,
    billingMonth: r.billingMonth,
    source: r.source,
    status: r.status,
    currency: r.currency,
    totalCents: Number(r.totalCents) || 0,
    reversedCents: Number(r.reversedCents) || 0,
    count: Number(r.count) || 0,
  }));

  // Pick the primary currency (most ledger rows) and aggregate only that currency so
  // amounts are never summed across currencies.
  const currencyCounts = new Map<string, number>();
  for (const row of normalized) {
    currencyCounts.set(
      row.currency,
      (currencyCounts.get(row.currency) ?? 0) + row.count,
    );
  }
  const currencies = [...currencyCounts.keys()].sort();
  const currency =
    [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'eur';

  const scoped = normalized.filter((row) => row.currency === currency);

  const overall = emptyBucket();
  const thisMonth = emptyBucket();
  const monthBuckets = new Map<string, FinanceMonth>();
  const storeBuckets = new Map<string, FinanceBucket>();

  for (const row of scoped) {
    fold(overall, row);

    if (row.billingMonth === currentMonth) {
      fold(thisMonth, row);
    }

    let month = monthBuckets.get(row.billingMonth);
    if (!month) {
      month = { billingMonth: row.billingMonth, ...emptyBucket() };
      monthBuckets.set(row.billingMonth, month);
    }
    fold(month, row);

    let store = storeBuckets.get(row.storeId);
    if (!store) {
      store = emptyBucket();
      storeBuckets.set(row.storeId, store);
    }
    fold(store, row);
  }

  // Resolve store names + billing modes for the stores that appear in the ledger.
  const storeIds = [...storeBuckets.keys()];
  const storeMeta = new Map<string, { name: string; billingMode: BillingMode }>();
  if (storeIds.length > 0) {
    const metaRows = await db
      .select({
        id: stores.id,
        name: stores.name,
        billingMode: subscriptions.billingMode,
      })
      .from(stores)
      .leftJoin(subscriptions, sql`${subscriptions.storeId} = ${stores.id}`)
      .where(inArray(stores.id, storeIds));

    for (const meta of metaRows) {
      if (storeBuckets.has(meta.id)) {
        storeMeta.set(meta.id, {
          name: meta.name,
          billingMode: meta.billingMode ?? 'subscription',
        });
      }
    }
  }

  const byMonth = [...monthBuckets.values()].sort((a, b) =>
    b.billingMonth.localeCompare(a.billingMonth),
  );

  const byStore: FinanceStore[] = [...storeBuckets.entries()]
    .map(([storeId, bucket]) => ({
      storeId,
      storeName: storeMeta.get(storeId)?.name ?? storeId,
      billingMode: storeMeta.get(storeId)?.billingMode ?? 'subscription',
      ...bucket,
    }))
    .sort((a, b) => b.realizedCents - a.realizedCents);

  return {
    currentMonth,
    currency,
    currencies,
    overall,
    thisMonth,
    byMonth,
    byStore,
  };
}

/** Most recent individual fee ledger entries, for an audit/detail view. Newest first. */
export interface FinanceLedgerEntry {
  id: string;
  storeId: string;
  reservationId: string;
  amountCents: number;
  currency: string;
  source: FeeSource;
  status: FeeStatus;
  billingMonth: string;
  createdAt: Date;
}

export async function getRecentPlatformFees(
  limit = 50,
): Promise<FinanceLedgerEntry[]> {
  await assertPlatformAdmin();
  const rows = await db
    .select({
      id: platformFees.id,
      storeId: platformFees.storeId,
      reservationId: platformFees.reservationId,
      amountCents: platformFees.amountCents,
      currency: platformFees.currency,
      source: platformFees.source,
      status: platformFees.status,
      billingMonth: platformFees.billingMonth,
      createdAt: platformFees.createdAt,
    })
    .from(platformFees)
    .orderBy(desc(platformFees.createdAt))
    .limit(limit);

  return rows as FinanceLedgerEntry[];
}
