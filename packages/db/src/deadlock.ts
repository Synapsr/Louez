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

export async function retryOnceOnDeadlock<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isDatabaseDeadlock(error)) throw error;
    return operation();
  }
}
