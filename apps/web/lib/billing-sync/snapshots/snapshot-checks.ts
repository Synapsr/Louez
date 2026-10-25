import { toMinor } from "@/lib/billing-sync/money";

/**
 * A snapshot Louez cannot express within the contract: an amount out of range, a
 * list over its limit, a broken row. Retrying cannot fix it, so the relay marks the
 * queue row dead and alerts. Any other error from a builder (a lost connection) is
 * a transient failure.
 */
export class SnapshotDataError extends Error {
  constructor(aggregate: string, detail: string) {
    super(`${aggregate}: ${detail}`);
    this.name = "SnapshotDataError";
  }
}

/** `AmountMinor` and `SignedAmountMinor` of openapi.yaml: Louez's `decimal(10,2)` maximum. */
const MAX_MINOR = 9_999_999_999;

/**
 * Converters that turn stored values into contract values, and throw a
 * `SnapshotDataError` naming the aggregate and the field when a value does not fit.
 * Messages carry ids and field names, never amounts.
 */
export function snapshotChecks(aggregate: string) {
  const fail = (detail: string): never => {
    throw new SnapshotDataError(aggregate, detail);
  };

  const timestamp = (field: string, value: Date): string => {
    if (Number.isNaN(value.getTime())) fail(`${field} is not a valid date`);
    return value.toISOString();
  };

  const signedAmount = (field: string, value: number): number => {
    if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MINOR)
      fail(`${field} is not an integer amount within ±${MAX_MINOR}`);
    return value;
  };

  return {
    fail,
    timestamp,
    timestampOrNull: (field: string, value: Date | null): string | null =>
      value === null ? null : timestamp(field, value),
    signedAmount,
    amount: (field: string, value: number): number => {
      signedAmount(field, value);
      if (value < 0) fail(`${field} is negative`);
      return value;
    },
    /** A stored `decimal(10,2)` string, in minor units of `currency` (fees.md §3). */
    decimal: (field: string, value: string, currency: string): number => {
      const result = toMinor(value, currency);
      if ("error" in result) return fail(`${field} cannot be converted (${result.error})`);
      return signedAmount(field, result.minor);
    },
    count: (field: string, value: number, max = Number.MAX_SAFE_INTEGER): number => {
      if (!Number.isSafeInteger(value) || value < 0 || value > max)
        fail(`${field} is not an integer between 0 and ${max}`);
      return value;
    },
    positiveOrNull: (field: string, value: number | null): number | null => {
      if (value !== null && (!Number.isSafeInteger(value) || value < 1))
        fail(`${field} is not a positive integer`);
      return value;
    },
    text: (field: string, value: string, maxLength: number): string => {
      if (value.length > maxLength) fail(`${field} is longer than ${maxLength} characters`);
      return value;
    },
    textOrNull: (field: string, value: string | null, maxLength: number): string | null => {
      if (value !== null && value.length > maxLength)
        fail(`${field} is longer than ${maxLength} characters`);
      return value;
    },
    /** A UTC month, `YYYY-MM`. */
    period: (field: string, value: string): string => {
      if (!isPeriod(value)) fail(`${field} is not a YYYY-MM month`);
      return value;
    },
    /** The contract refuses a list over its limit, and a truncated list would lie. */
    limit: (field: string, size: number, max: number): void => {
      if (size > max) fail(`${field} has ${size} entries, above the limit of ${max}`);
    },
  };
}

export type SnapshotChecks = ReturnType<typeof snapshotChecks>;

/** An ISO 3166-1 alpha-2 code, upper-cased, or null when the stored value is not one. */
export function countryOrNull(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * String order by UTF-16 code units, as the canonical JSON sorts keys. Not
 * `localeCompare` or a SQL collation: the order, and so the hash, must not depend
 * on the runtime's locale or the database's case folding.
 */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isPeriod(value: string): boolean {
  return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
