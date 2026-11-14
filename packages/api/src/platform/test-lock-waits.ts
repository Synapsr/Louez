/**
 * The database tests' lock observer: it waits for a transaction that waits
 * for a lock, read from InnoDB's own record of lock waits
 * (`performance_schema.data_lock_waits`), never from a statement's text. Not
 * served by the app.
 */
import { sql } from "drizzle-orm";

interface Executor {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

let observing = false;

/**
 * Resolves once at least `count` transactions wait for a lock on a row of
 * `table`, in this connection's database. One observer runs at a time, and a
 * second one is refused while it does: each must be awaited, or cancelled
 * through `signal`, before the next starts. It gives up after `timeoutMs`.
 */
export async function lockWaitsOn(
  db: Executor,
  table: string,
  options: { count?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  if (observing) throw new Error("Another lock observer is running: await or cancel it first.");
  observing = true;
  const count = options.count ?? 1;
  // A monotonic clock: a test may move the date.
  const deadline = performance.now() + (options.timeoutMs ?? 5_000);
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const [rows] = (await db.execute(
        sql`SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS n
          FROM performance_schema.data_lock_waits w
          JOIN performance_schema.data_locks l
            ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
          WHERE l.OBJECT_SCHEMA = DATABASE() AND l.OBJECT_NAME = ${table}`,
      )) as [Array<{ n: number | string }>];
      if (Number(rows[0]?.n) >= count) return;
      if (performance.now() > deadline) {
        throw new Error(`No transaction waited for a lock on ${table}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    observing = false;
  }
}
