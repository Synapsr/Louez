import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";

import { type DatabaseOnConnection, databaseOnConnection, db } from "@louez/db";

// MySQL named locks, each held on its own pooled connection for the whole run: a
// pooled `db.execute` may take and release the lock on two connections and leak it
// (louez-billing docs/api, fees.md §9). The run gets that connection, so its writes
// need no second one from the pool.
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
 * still taken after the timeout or MySQL fails to take it. `run` gets Drizzle on the
 * connection that holds the lock: a transaction opened on it stays on that connection.
 */
export async function withNamedLock<T>(
  name: string,
  timeoutSeconds: number,
  run: (lockedDb: DatabaseOnConnection) => Promise<T>,
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
      return { ran: true, value: await run(databaseOnConnection(connection)) };
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

/**
 * At most `size` runs at once in this process. A run waits its turn for up to
 * `waitMs`, or until `signal` aborts, then does not run. A run that waits on a named
 * lock holds a pooled connection all along: the limit keeps a burst of them from taking
 * the whole pool the rest of the app queries on.
 */
export function createRunLimit(size: number) {
  let running = 0;
  const waiting: Array<() => void> = [];

  const turn = (waitMs: number, signal?: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      const stop = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        const index = waiting.indexOf(wake);
        if (index !== -1) waiting.splice(index, 1);
        resolve(false);
      };
      const wake = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        resolve(true);
      };
      const timer = setTimeout(stop, waitMs);
      waiting.push(wake);
      signal?.addEventListener("abort", stop, { once: true });
    });

  return async function limited<T>(
    waitMs: number,
    run: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<LockedRun<T>> {
    if (signal?.aborted) return { ran: false };
    if (running < size) running++;
    else if (!(await turn(waitMs, signal))) return { ran: false };
    try {
      return { ran: true, value: await run() };
    } finally {
      // The next waiter takes this run's place, so `running` only drops when none waits.
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
