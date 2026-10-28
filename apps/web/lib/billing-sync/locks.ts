import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";

import { db } from "@louez/db";

// MySQL named locks, each held on its own pooled connection for the whole run: a
// pooled `db.execute` may take and release the lock on two connections and leak it
// (louez-billing docs/api, fees.md §9).
//
// One run of each billing task at a time, across every Louez instance: a cron call
// that finds the lock taken skips the task instead of waiting (plan decision 12).
// `legacy-run` is the monthly pay-as-you-go billing (lib/pay-as-you-go/legacy-run.ts).

export type BillingTask = "relay" | "heartbeat" | "manifests" | "sweep" | "legacy-run";

export type LockedRun<T> = { readonly ran: true; readonly value: T } | { readonly ran: false };

const lockRow = z.object({ got: z.union([z.number(), z.string(), z.null()]) });

export function billingLockName(task: BillingTask): string {
  return `louez:billing:${task}`;
}

/**
 * Runs `run` under `GET_LOCK(name, timeoutSeconds)`, or not at all when the lock is
 * still taken after the timeout or MySQL fails to take it.
 */
export async function withNamedLock<T>(
  name: string,
  timeoutSeconds: number,
  run: () => Promise<T>,
): Promise<LockedRun<T>> {
  const connection = await db.$client.getConnection();
  let healthy = true;
  try {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS got", [
      name,
      timeoutSeconds,
    ]);
    const [row] = z.array(lockRow).parse(rows);
    if (Number(row?.got) !== 1) return { ran: false };
    try {
      return { ran: true, value: await run() };
    } finally {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [name]);
      } catch {
        // A broken connection already lost its lock; never hand it back to the pool.
        healthy = false;
      }
    }
  } finally {
    if (healthy) connection.release();
    else connection.destroy();
  }
}

export function withBillingLock<T>(
  task: BillingTask,
  run: () => Promise<T>,
): Promise<LockedRun<T>> {
  return withNamedLock(billingLockName(task), 0, run);
}
