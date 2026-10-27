import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";

import { db } from "@louez/db";

// One run of each billing task at a time, across every Louez instance: a MySQL
// named lock held on its own pooled connection for the whole run. A cron call that
// finds the lock taken skips the task instead of waiting (plan decision 12).
// `legacy-run` is the monthly pay-as-you-go billing (lib/pay-as-you-go/legacy-run.ts).

export type BillingTask = "relay" | "heartbeat" | "manifests" | "sweep" | "legacy-run";

export type LockedRun<T> = { readonly ran: true; readonly value: T } | { readonly ran: false };

const lockRow = z.object({ got: z.union([z.number(), z.string(), z.null()]) });

export function billingLockName(task: BillingTask): string {
  return `louez:billing:${task}`;
}

export async function withBillingLock<T>(
  task: BillingTask,
  run: () => Promise<T>,
): Promise<LockedRun<T>> {
  const name = billingLockName(task);
  const connection = await db.$client.getConnection();
  let healthy = true;
  try {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [name]);
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
