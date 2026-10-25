import { createHash } from "node:crypto";

/**
 * RFC 8785 (JCS) canonical JSON for values built from JSON data, the form the
 * billing contract hashes snapshot `data` with (README §3). Keys sort by UTF-16
 * code units, as `Array.prototype.sort` does; numbers and strings use ECMAScript
 * serialization.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS cannot encode a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new TypeError(`JCS cannot encode a value of type ${typeof value}`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** The hash Louez compares with `sent_hash` to skip unchanged snapshots. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
