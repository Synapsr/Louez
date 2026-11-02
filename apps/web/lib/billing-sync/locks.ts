import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";

import { type DatabaseOnConnection, databaseOnConnection, db } from "@louez/db";

import { log } from "@/lib/evlog";

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
 * MySQL closes a lock's connection, and so frees the lock, after this long without a
 * word from Louez. A connection the network drops without telling either end would
 * otherwise keep its lock until the server's own TCP timeout: on the dev app, on
 * 2026-10-30, the heartbeat lock stayed held 2 h 13 min that way and every cron call
 * skipped the heartbeat.
 */
export const LOCK_IDLE_SECONDS = 120;
/** How often a run that holds a lock keeps its connection talking, well within the idle limit. */
const LOCK_PING_MS = 30_000;
/** How long the release and the reset may take before the connection counts as broken. */
const LOCK_QUERY_TIMEOUT_MS = 10_000;

/** A lock that stays taken this long by the same connection is logged, with who holds it… */
const BUSY_LOG_AFTER_MS = 2 * 60_000;
/** …and again at most this often while it stays taken. */
const BUSY_LOG_EVERY_MS = 10 * 60_000;

export type NamedLockOptions = {
  readonly idleSeconds?: number;
  readonly pingMs?: number;
  readonly busyLogAfterMs?: number;
  readonly busyLogEveryMs?: number;
  readonly log?: {
    error(tag: string, message: string): void;
    warn(tag: string, message: string): void;
  };
};

/** Each lock this process found taken: by which connection, since when, last logged when. */
const busyLocks = new Map<string, { holder: number; since: number; loggedAt: number | null }>();

const holderRow = z.object({
  user: z.string().nullable(),
  host: z.string().nullable(),
  command: z.string().nullable(),
  seconds: z.union([z.number(), z.string()]).nullable(),
  program: z.string().nullable(),
});

/** `query`, or a rejection after `ms`: a query sent on a dead connection may wait 15 minutes. */
function within<T>(query: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from MySQL within ${ms} ms`)), ms);
  });
  query.catch(() => {});
  return Promise.race([query, timeout]).finally(() => clearTimeout(timer));
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Who holds `name`, logged once the same connection has held it `busyLogAfterMs`: on the
 * dev app, on 2026-11-02, the heartbeat lock stayed taken 55 min by a client this process
 * could not name. Reading another session needs MySQL's PROCESS privilege; without it
 * the log gives the connection id alone.
 */
async function noteBusyLock(
  connection: PoolConnection,
  name: string,
  options: { afterMs: number; everyMs: number; logs: Required<NamedLockOptions>["log"] },
): Promise<void> {
  const [rows] = await connection.query<RowDataPacket[]>("SELECT IS_USED_LOCK(?) AS holder", [
    name,
  ]);
  const holder = Number(rows[0]?.holder);
  if (!Number.isInteger(holder) || holder <= 0) return;

  const now = Date.now();
  const known = busyLocks.get(name);
  const busy = known?.holder === holder ? known : { holder, since: now, loggedAt: null };
  busyLocks.set(name, busy);
  if (now - busy.since < options.afterMs) return;
  if (busy.loggedAt !== null && now - busy.loggedAt < options.everyMs) return;
  busy.loggedAt = now;

  let who = "";
  try {
    const [details] = await connection.query<RowDataPacket[]>(
      `SELECT p.USER AS user, p.HOST AS host, p.COMMAND AS command, p.TIME AS seconds,
         (SELECT a.ATTR_VALUE FROM performance_schema.session_connect_attrs a
           WHERE a.PROCESSLIST_ID = p.ID AND a.ATTR_NAME = 'program_name') AS program
       FROM performance_schema.processlist p WHERE p.ID = ?`,
      [holder],
    );
    const row = z.array(holderRow).parse(details)[0];
    if (row) {
      const client = row.program ?? "a client without program_name, so older than this log";
      who = ` (${row.user}@${row.host}, ${client}, ${row.command} for ${row.seconds} s)`;
    }
  } catch (error) {
    who = ` (no details: ${errorMessage(error)})`;
  }
  const minutes = Math.floor((now - busy.since) / 60_000);
  options.logs.warn(
    "billing",
    `lock ${name}: taken for at least ${minutes} min by MySQL connection ${holder}${who}; KILL ${holder} frees it`,
  );
}

/**
 * Runs `run` under `GET_LOCK(name, timeoutSeconds)`, or not at all when the lock is
 * still taken after the timeout or MySQL fails to take it. `run` gets Drizzle on the
 * connection that holds the lock: a transaction opened on it stays on that connection.
 *
 * The connection's `wait_timeout` is `LOCK_IDLE_SECONDS` while it holds the lock, and
 * a ping every `LOCK_PING_MS` keeps it under that limit during a long run. A lock whose
 * connection Louez loses is so freed within the limit, and the loss is logged. A lock
 * found taken by the same connection for `BUSY_LOG_AFTER_MS` is logged with its holder.
 */
export async function withNamedLock<T>(
  name: string,
  timeoutSeconds: number,
  run: (lockedDb: DatabaseOnConnection) => Promise<T>,
  options: NamedLockOptions = {},
): Promise<LockedRun<T>> {
  const idleSeconds = options.idleSeconds ?? LOCK_IDLE_SECONDS;
  const pingMs = options.pingMs ?? LOCK_PING_MS;
  const logs = options.log ?? log;
  const connection = await db.$client.getConnection();
  let healthy = true;
  try {
    let got: unknown;
    try {
      await connection.query("SET SESSION wait_timeout = ?", [idleSeconds]);
      const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS got", [
        name,
        timeoutSeconds,
      ]);
      got = z.array(lockRow).parse(rows)[0]?.got;
    } catch (error) {
      healthy = false;
      throw error;
    }
    if (Number(got) !== 1) {
      if (Number(got) === 0) {
        try {
          await within(
            noteBusyLock(connection, name, {
              afterMs: options.busyLogAfterMs ?? BUSY_LOG_AFTER_MS,
              everyMs: options.busyLogEveryMs ?? BUSY_LOG_EVERY_MS,
              logs,
            }),
            LOCK_QUERY_TIMEOUT_MS,
          );
        } catch {
          healthy = false;
        }
      }
      return { ran: false };
    }
    busyLocks.delete(name);
    const ping = setInterval(() => {
      connection.query("SELECT 1").catch(() => {});
    }, pingMs);
    try {
      return { ran: true, value: await run(databaseOnConnection(connection)) };
    } finally {
      clearInterval(ping);
      try {
        await within(connection.query("SELECT RELEASE_LOCK(?)", [name]), LOCK_QUERY_TIMEOUT_MS);
      } catch (error) {
        // MySQL may still hold the lock for a connection the network dropped: it frees
        // it once the connection has been silent for `idleSeconds`.
        healthy = false;
        logs.error(
          "billing",
          `lock ${name}: release failed (${errorMessage(error)}); MySQL frees it within ${idleSeconds} s`,
        );
      }
    }
  } finally {
    if (healthy) {
      try {
        await within(
          connection.query("SET SESSION wait_timeout = @@GLOBAL.wait_timeout"),
          LOCK_QUERY_TIMEOUT_MS,
        );
      } catch {
        healthy = false;
      }
    }
    // A connection that failed is never handed back to the pool.
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
