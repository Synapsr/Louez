/**
 * MySQL resolves a deadlock by rolling back one transaction with error 1213.
 * Writers that take several row locks in a different order from a concurrent
 * path run the operation again once, as a fresh transaction.
 */
export function isDatabaseDeadlock(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const databaseError = error as {
    code?: unknown;
    cause?: unknown;
    errno?: unknown;
    sqlState?: unknown;
  };
  return (
    databaseError.code === "ER_LOCK_DEADLOCK" ||
    databaseError.errno === 1213 ||
    databaseError.sqlState === "40001" ||
    (databaseError.cause !== error && isDatabaseDeadlock(databaseError.cause))
  );
}

/**
 * An error that ended the whole transaction it ran in, or left it unable to
 * go on, so the transaction must run again from its start rather than carry
 * on past the failed statement: a deadlock (MySQL rolled the transaction
 * back), a lock wait that timed out, or a savepoint that no longer exists (a
 * rollback inside a savepoint whose transaction MySQL already rolled back,
 * as after a deadlock).
 */
export function isTransactionInterrupted(error: unknown): boolean {
  if (isDatabaseDeadlock(error)) return true;
  for (let current = error, depth = 0; current && depth < 8; depth += 1) {
    if (typeof current !== "object") return false;
    const databaseError = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (
      databaseError.code === "ER_LOCK_WAIT_TIMEOUT" ||
      databaseError.errno === 1205 ||
      databaseError.code === "ER_SP_DOES_NOT_EXIST" ||
      databaseError.errno === 1305
    ) {
      return true;
    }
    if (databaseError.cause === current) return false;
    current = databaseError.cause;
  }
  return false;
}

export async function retryOnceOnDeadlock<T>(operation: () => Promise<T>): Promise<T> {
  return retryTransactionOnDeadlock(operation, { attempts: 2 });
}

/**
 * Runs a whole transaction again when MySQL rolled it back as a deadlock
 * victim, up to `attempts` runs in all. A rolled-back run committed nothing,
 * so `operation` must be the transaction alone: its effects (fees, emails,
 * provider calls) run after this returns, once. `retryOn` widens what starts
 * a new run, such as a caller's own "start over" error.
 *
 * For the writers that still lock a reservation before its products
 * (docs/code-review/04-data-layer.md, DL-12): either side of that lock pair
 * may lose, and losing must not fail the request.
 */
export async function retryTransactionOnDeadlock<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    retryOn?: (error: unknown) => boolean;
    /** Waits between runs; tests pass their own. */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const retryOn = options.retryOn ?? isDatabaseDeadlock;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !retryOn(error)) throw error;
      await sleep(deadlockRetryDelayMs(attempt));
    }
  }
}

/**
 * The wait before the next run: 20 to 80 ms at random, times the runs so far,
 * so two transactions that collided do not collide again at once. Three runs
 * wait at most 80 + 160 ms.
 */
export function deadlockRetryDelayMs(failedRuns: number, random: () => number = Math.random) {
  return Math.round((20 + random() * 60) * failedRuns);
}
