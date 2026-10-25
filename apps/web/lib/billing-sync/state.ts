import { type SQL, eq, sql } from "drizzle-orm";
import type { MySqlUpdateSetSource } from "drizzle-orm/mysql-core";
import { z } from "zod";

import { type Database, type Transaction, billingSyncState, db } from "@louez/db";

// The single billing_sync_state row (id 1), shared by the relay, the heartbeat,
// the policy pull, the manifests and the sweep. Created on demand.

const STATE_ID = 1;

export type SyncExecutor = Database | Transaction;
export type SyncState = typeof billingSyncState.$inferSelect;
export type SyncStateUpdate = MySqlUpdateSetSource<typeof billingSyncState>;

export async function readSyncState(executor: SyncExecutor = db): Promise<SyncState> {
  await executor.insert(billingSyncState).ignore().values({ id: STATE_ID });
  const [row] = await executor
    .select()
    .from(billingSyncState)
    .where(eq(billingSyncState.id, STATE_ID));
  if (!row) throw new Error("billing_sync_state row 1 is missing after its insert");
  return row;
}

export async function updateSyncState(
  values: SyncStateUpdate,
  executor: SyncExecutor = db,
): Promise<void> {
  await executor.insert(billingSyncState).ignore().values({ id: STATE_ID });
  await executor
    .update(billingSyncState)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(billingSyncState.id, STATE_ID));
}

/** True while a `Retry-After` from the service has not passed (README §6). */
export function isWaitingForRetryAfter(state: SyncState, now: Date = new Date()): boolean {
  return state.retryAfterUntil !== null && state.retryAfterUntil.getTime() > now.getTime();
}

/** Seconds from the epoch, from `UNIX_TIMESTAMP(...)`, as a Date. Null stays null. */
export const unixSeconds = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => (value === null ? null : new Date(Math.round(Number(value) * 1000))));

/** A count or sum, which mysql2 returns as a number or a decimal string. */
export const sqlNumber = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => (value === null ? 0 : Number(value)));

/** Runs a raw SELECT and checks each row against `schema`. */
export async function selectRows<T>(
  executor: SyncExecutor,
  query: SQL,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const [rows] = await executor.execute(query);
  return z.array(schema).parse(rows);
}

/** Rows changed by a raw UPDATE or INSERT. */
export async function executeWrite(executor: SyncExecutor, query: SQL): Promise<number> {
  const [header] = await executor.execute(query);
  return header.affectedRows;
}

/**
 * The database clock. Marks and queue times use it, so instants Louez reports next
 * to them (observedAt, at, lastSweepAt) come from the same clock. UNIX_TIMESTAMP
 * does not depend on the session time zone.
 */
export async function databaseNow(executor: SyncExecutor = db): Promise<Date> {
  const [row] = await selectRows(
    executor,
    sql`SELECT UNIX_TIMESTAMP(NOW(3)) AS now`,
    z.object({ now: unixSeconds }),
  );
  if (!row?.now) throw new Error("the database returned no clock");
  return row.now;
}

/** A Date as the UTC `YYYY-MM-DD HH:MM:SS.mmm` text drizzle writes timestamps with. */
export function utcSqlTime(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

/** `YYYY-MM` of a date, in UTC (README §3: periods are UTC months). */
export function utcPeriod(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The first instant of a `YYYY-MM` period and of the next one, in UTC. */
export function periodBounds(period: string): { start: Date; end: Date } {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) throw new Error(`not a period: ${period}`);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/** The period before `period`. */
export function previousPeriod(period: string): string {
  const { start } = periodBounds(period);
  return utcPeriod(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)));
}

/** Text that fits a varchar(1000) error column. */
export function errorText(message: string): string {
  return message.length > 1000 ? `${message.slice(0, 999)}…` : message;
}
