import { REDACTED, redactHandoffSecrets } from "./redact";

/**
 * Errors as facts safe to log or send to an error tracker. An error's
 * message may carry what a request held: a customer's e-mail in a duplicate
 * key, a token a provider echoes, a URL with its query, a failed query's
 * parameters. `sanitizeText` removes those; `sanitizeError` keeps only a
 * short list of fields (name, message, codes, stack frames, cause), each
 * sanitized, and never the error object itself, whose other properties
 * (Stripe's `raw`, a request's headers) are left out.
 */

/** Longest message kept: past it, the text is cut. */
const MESSAGE_MAX = 1_000;
/** Stack frames kept by default. */
const FRAMES_MAX = 10;
/** Causes followed at most. */
const CAUSE_DEPTH = 2;

type Rule = readonly [RegExp, string];

/**
 * In order: a later rule must not see what an earlier one already replaced
 * (a URL's user before an e-mail, a query before its `token=`).
 */
const RULES: readonly Rule[] = [
  // A URL's user and password, then its query and fragment.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@"'<>]+@/gi, `$1${REDACTED}@`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, `$1?${REDACTED}`],
  // A failed query's parameters (Drizzle: "params: a,b,c").
  [/(\bparams:\s*)[^\n]*/gi, `$1${REDACTED}`],
  // A value MySQL quotes back ("Duplicate entry 'x' for key").
  [/(\bDuplicate entry\s+)'[^']*'/gi, `$1'${REDACTED}'`],
  // An authorization scheme's credential.
  [/\b(Bearer|Basic|Digest|Token)\s+[A-Za-z0-9._~+/=:-]+/gi, `$1 ${REDACTED}`],
  // A sensitive field's value: a header, a form field, a JSON key.
  [
    /\b((?:proxy-)?authorization|set-cookie|cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passwd|token)(["']?\s*[:=]\s*["']?)(?!Bearer\b|Basic\b|Digest\b|Token\b)[^\s"',;&]+/gi,
    `$1$2${REDACTED}`,
  ],
  // A JSON Web Token.
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, REDACTED],
  // Keys: Louez's API keys, Stripe's secret, restricted and webhook keys, a client secret.
  [/\blz_[A-Za-z0-9]{4}_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\b[a-z]{2,8}_[A-Za-z0-9]{8,}_secret_[A-Za-z0-9]{8,}/g, REDACTED],
  // An e-mail address.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, REDACTED],
];

/** `text` without the personal data and secrets it may hold, cut to `max` characters. */
export function sanitizeText(text: string, max = MESSAGE_MAX): string {
  const clean = RULES.reduce((result, [pattern, replacement]) => {
    pattern.lastIndex = 0;
    return result.replace(pattern, replacement);
  }, redactHandoffSecrets(text));
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** An error as it may be logged or reported: allowlisted fields, each sanitized. */
export interface SanitizedError {
  name: string;
  message: string;
  /** A provider's or a driver's codes (`code`, Stripe's `type`, an HTTP `statusCode`). */
  code?: string;
  type?: string;
  statusCode?: number;
  /** The stack's frames, `at …` lines only, without the message the stack starts with. */
  frames: string[];
  cause?: SanitizedError;
}

const shortCode = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? sanitizeText(String(value), 100)
    : undefined;

/** `error` as a `SanitizedError`: never its own object, nor a property outside the list. */
export function sanitizeError(
  error: unknown,
  options: { frames?: number } = {},
  depth = 0,
): SanitizedError {
  if (!(error instanceof Error)) {
    // Not `JSON.stringify`: a thrown object may hold anything.
    const text = typeof error === "string" ? error : `a thrown ${typeof error}`;
    return { name: "NonError", message: sanitizeText(text), frames: [] };
  }
  const statusCode = Reflect.get(error, "statusCode");
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .slice(0, options.frames ?? FRAMES_MAX)
    .map((line) => sanitizeText(line.trim(), 300));
  const code = shortCode(Reflect.get(error, "code"));
  const type = shortCode(Reflect.get(error, "type"));
  const cause = Reflect.get(error, "cause");
  return {
    name: sanitizeText(error.name, 100),
    message: sanitizeText(error.message),
    ...(code === undefined ? {} : { code }),
    ...(type === undefined ? {} : { type }),
    ...(typeof statusCode === "number" ? { statusCode } : {}),
    frames,
    ...(cause !== undefined && depth < CAUSE_DEPTH
      ? { cause: sanitizeError(cause, options, depth + 1) }
      : {}),
  };
}

/**
 * A provider's error as one line safe to log: its name, message and codes
 * (Stripe's `type`, `code`, `statusCode`), sanitized.
 */
export function describeProviderError(error: unknown): string {
  const facts = sanitizeError(error, { frames: 0 });
  if (facts.name === "NonError") return facts.message;
  const codes = (["type", "code", "statusCode"] as const)
    .filter((key) => facts[key] !== undefined)
    .map((key) => `${key}=${String(facts[key])}`);
  return `${facts.name}: ${facts.message}${codes.length > 0 ? ` (${codes.join(", ")})` : ""}`;
}

/** Logs a provider call that failed, as `describeProviderError` writes it. */
export function logProviderError(label: string, error: unknown): void {
  console.error(`${label}: ${describeProviderError(error)}`);
}
