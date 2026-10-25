import { and, asc, eq, exists, gt, gte, inArray, lte, or } from "drizzle-orm";

import {
  type BillingMark,
  db,
  markBillingDirty,
  paymentDisputes,
  payments,
  reservations,
  stores,
} from "@louez/db";

import { billingSyncConfig } from "@/lib/billing-sync/config";
import { newStoresCutoff } from "@/lib/billing-sync/policies";
import {
  databaseNow,
  previousPeriod,
  readSyncState,
  updateSyncState,
  utcPeriod,
} from "@/lib/billing-sync/state";

// The nightly sweep (louez-billing docs/api, README §7.4): plain marks on everything
// that may have changed without a mark, so a missed mark heals within a day. An
// unchanged snapshot costs the relay a hash comparison and is not sent.

const SWEEP_HOUR_UTC = 2;
const BATCH = 500;
const WINDOW_DAYS = 40;
const OPEN_STATUSES = ["pending", "quote", "confirmed", "ongoing"] as const;

/** 02:00 UTC, once a day: due from 02:00 until a sweep finished after it. */
export function isSweepDue(now: Date, lastSweepAt: Date | null): boolean {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SWEEP_HOUR_UTC);
  return now.getTime() >= today && (lastSweepAt === null || lastSweepAt.getTime() < today);
}

export type SweepResult =
  | { readonly due: false }
  | {
      readonly due: true;
      readonly stores: number;
      readonly reservations: number;
      readonly legacy: number;
      readonly lastSweepAt: string;
    };

export async function runSweep(now: Date = new Date()): Promise<SweepResult> {
  const state = await readSyncState();
  if (!isSweepDue(now, state.lastSweepAt)) return { due: false };

  const newStoresFrom = await newStoresCutoff(billingSyncConfig().newStoresFrom);
  const current = utcPeriod(now);
  const periods = [current, previousPeriod(current)];
  const counts = { stores: 0, reservations: 0, legacy: 0 };

  // Every store, with its legacy_store and the legacy_month of this month and the
  // previous one while it is not new.
  let storeCursor = "";
  for (;;) {
    const page = await db
      .select({ id: stores.id, createdAt: stores.createdAt })
      .from(stores)
      .where(gt(stores.id, storeCursor))
      .orderBy(asc(stores.id))
      .limit(BATCH);
    if (page.length === 0) break;
    storeCursor = page[page.length - 1]?.id ?? storeCursor;
    const marks: BillingMark[] = [];
    for (const store of page) {
      marks.push({ type: "store", aggregateId: store.id, storeId: store.id });
      counts.stores += 1;
      if (store.createdAt.getTime() >= newStoresFrom.getTime()) continue;
      marks.push({ type: "legacy_store", aggregateId: store.id, storeId: store.id });
      for (const period of periods) {
        marks.push({
          type: "legacy_month",
          aggregateId: `${store.id}:${period}`,
          storeId: store.id,
        });
      }
      counts.legacy += 1 + periods.length;
    }
    await markBillingDirty(db, marks);
  }

  // Open reservations, those that ended in the last 40 days, and those with a payment,
  // refund or dispute row created or updated in the last 40 days (row times, not
  // paidAt, which a user can set to any date).
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  let reservationCursor = "";
  for (;;) {
    const page = await db
      .select({ id: reservations.id, storeId: reservations.storeId })
      .from(reservations)
      .where(
        and(
          gt(reservations.id, reservationCursor),
          or(
            inArray(reservations.status, [...OPEN_STATUSES]),
            and(gte(reservations.endDate, since), lte(reservations.endDate, now)),
            exists(
              db
                .select({ id: payments.id })
                .from(payments)
                .where(
                  and(
                    eq(payments.reservationId, reservations.id),
                    or(gte(payments.createdAt, since), gte(payments.updatedAt, since)),
                  ),
                ),
            ),
            exists(
              db
                .select({ id: paymentDisputes.id })
                .from(paymentDisputes)
                .where(
                  and(
                    eq(paymentDisputes.reservationId, reservations.id),
                    or(
                      gte(paymentDisputes.createdAt, since),
                      gte(paymentDisputes.updatedAt, since),
                    ),
                  ),
                ),
            ),
          ),
        ),
      )
      .orderBy(asc(reservations.id))
      .limit(BATCH);
    if (page.length === 0) break;
    reservationCursor = page[page.length - 1]?.id ?? reservationCursor;
    await markBillingDirty(
      db,
      page.map((row) => ({ type: "reservation", aggregateId: row.id, storeId: row.storeId })),
    );
    counts.reservations += page.length;
  }

  // Every mark above is committed: the sweep's time, from the clock the marks use.
  const lastSweepAt = await databaseNow();
  await updateSyncState({ lastSweepAt });
  return { due: true, ...counts, lastSweepAt: lastSweepAt.toISOString() };
}
