/**
 * Reading JSON the CLI did not write (the API's answers, the config file)
 * field by field, without trusting its shape.
 */

/** An object's fields; undefined for anything else. */
export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The `code` of a Node.js system error, such as ENOENT. */
export function errorCode(error: unknown): string | undefined {
  return text(record(error)?.code);
}
