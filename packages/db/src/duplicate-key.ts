/**
 * MySQL's duplicate-key error (ER_DUP_ENTRY, errno 1062): an insert that lost a race on
 * a unique key, which idempotent writes take as "already done".
 *
 * Read the code, never the message. drizzle 0.45 throws a DrizzleQueryError whose
 * message holds only the query and its parameters; the driver's error, with the code,
 * is its `cause`. A transaction rethrows it as is.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ("code" in current && current.code === "ER_DUP_ENTRY") return true;
    if ("errno" in current && current.errno === 1062) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
