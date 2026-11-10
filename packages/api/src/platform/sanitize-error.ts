import { REDACTED, redactHandoffSecrets } from "./redact";

/**
 * Errors as facts safe to log or send to an error tracker. An error's
 * message may carry what a request held: a customer's e-mail in a duplicate
 * key, a token a provider echoes, a URL with its query, a failed query's
 * parameters, a phone number, a long opaque blob. `sanitizeText` removes
 * those; `sanitizeError` keeps only a short list of fields (name, message,
 * codes, stack frames, cause), each sanitized, and never the error object
 * itself, whose other properties (Stripe's `raw`, a request's headers, a
 * driver's `sql`) are left out. A database error keeps its code and the
 * names it gives (key, column, constraint, table), never the message that
 * quotes the values; a validation error keeps its issues' codes and paths.
 *
 * An absolute file path is named from the repository's root, or `[path]`.
 * Every pattern runs in linear time, and the text is cut before any of them
 * runs, so a huge or crafted message costs no more than a short one.
 */

/** Longest message kept: the text is cut to it before it is read. */
const MESSAGE_MAX = 1_000;
/** Stack frames kept by default. */
const FRAMES_MAX = 10;
/** Causes followed at most. */
const CAUSE_DEPTH = 2;
/** Validation issues kept at most. */
const ISSUES_MAX = 20;

type Replacement = string | ((match: string, ...groups: string[]) => string);
type Rule = readonly [RegExp, Replacement];

/** The fields whose value is secret, as a header, a form field or a JSON key names them. */
const SENSITIVE_KEY =
  "(?:proxy-)?authorization|x-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|session[_-]?(?:id|token)|secret|password|passwd|pwd|token|otp";

/**
 * In order: a later rule must not see what an earlier one already replaced
 * (a URL's user before an e-mail, a quoted value before its words). Each
 * starts only where its first characters stand and has bounded or
 * consuming repeats: none tries every position of a long run again.
 */
const RULES: readonly Rule[] = [
  // A URL's user and password.
  [/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,20}:\/\/)[^\s/?#@"'<>]{1,256}@/gi, `$1${REDACTED}@`],
  // A query (and what follows it, a fragment included), after a URL or a bare path.
  [/(?<=[A-Za-z0-9._~%/-])\?(?!\[redacted\])[^\s"'<>]+/g, `?${REDACTED}`],
  // A failed query's parameters (Drizzle: "params: a,b,c").
  [/(\bparams:[ \t]*)[^\n]*/gi, `$1${REDACTED}`],
  // Values a database quotes back: up to the words that follow them, or the line's end.
  [/(\bDuplicate entry\s)[^\n]*?(\sfor key\b|$)/gim, `$1'${REDACTED}'$2`],
  [/(\bIncorrect [a-z ]{1,40} value:?\s)[^\n]*?(\sfor column\b|$)/gim, `$1'${REDACTED}'$2`],
  [
    /(\bKey \([^)\n]{1,200}\)=\()[^\n]*?(\)\s(?:already exists|is not present|conflicts with)|$)/gim,
    `$1${REDACTED}$2`,
  ],
  [/(\bFailing row contains\s)[^\n]*/gi, `$1(${REDACTED})`],
  // A sensitive field's quoted value, whole, in JSON or key=value form.
  [
    new RegExp(
      `(["']?)\\b(${SENSITIVE_KEY})\\1([ \\t]{0,5}[:=][ \\t]{0,5})("(?:[^"\\\\\\n]|\\\\.){0,2000}(?:"|$)|'(?:[^'\\\\\\n]|\\\\.){0,2000}(?:'|$))`,
      "gim",
    ),
    (_match, quote: string, key: string, separator: string, value: string) =>
      `${quote}${key}${quote}${separator}${value.charAt(0)}${REDACTED}${value.charAt(0)}`,
  ],
  // A cookie or an authorization header: the whole value, to the line's end.
  [
    /\b(set-cookie|cookie|(?:proxy-)?authorization)\b([ \t]{0,5}[:=][ \t]{0,5})(?!["']\[redacted\])[^\n]*/gi,
    `$1$2${REDACTED}`,
  ],
  // An authorization scheme's credential, outside a header.
  [/\b(Bearer|Basic|Digest|Token)[ \t]{1,10}[A-Za-z0-9._~+/=:-]+/gi, `$1 ${REDACTED}`],
  // Another sensitive field's unquoted value.
  [
    new RegExp(
      `\\b(${SENSITIVE_KEY})([ \\t]{0,5}[:=][ \\t]{0,5})(?!\\[redacted\\])[^\\s,;&}\\]"']+`,
      "gi",
    ),
    `$1$2${REDACTED}`,
  ],
  // A JSON Web Token.
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, REDACTED],
  // Keys: Louez's API keys, Stripe's secret, restricted, publishable and webhook keys, a client secret.
  [/\blz_[A-Za-z0-9]{4}_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\b[a-z]{2,8}_[A-Za-z0-9]{8,}_secret_[A-Za-z0-9]{8,}/g, REDACTED],
  // Other services' keys: PostHog, GitHub, Slack, AWS.
  [/\bph[cxs]_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{8,}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  // An e-mail address: tried only where its local part starts, each part bounded.
  [
    /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}\b/g,
    REDACTED,
  ],
  // An international phone number (E.164, spaced or not).
  [/(?<![\w+])\+\d{1,3}(?:[ .-]?\d){7,13}\b/g, REDACTED],
  // An absolute file path: from the repository's root, or none (`relativePath`).
  [/(?<![^\s('"=,[])(?:file:\/\/)?(?:\/|[A-Za-z]:\\)[^\s'"()<>:,]*/g, (path) => relativePath(path)],
];

/** Where a path inside the repository starts: what precedes it is the machine's. */
const REPO_ROOTS = /[/\\](apps|packages|node_modules|docs|scripts)[/\\]/;
/** Roots of a machine's own files: a path under them, outside the repository, says nothing. */
const MACHINE_ROOTS =
  /^(?:\/(?:Users|home|root|private|var|tmp|opt|srv|mnt|app|workspace|builds?)(?:\/|$)|[A-Za-z]:\\)/;

/**
 * An absolute path as the repository names it (`/app/apps/web/.next/x.js`:
 * `apps/web/.next/x.js`), `[path]` under a machine's root (a home folder
 * names its user), and a route (`/dashboard/settings`) as it is.
 */
function relativePath(raw: string): string {
  const path = raw.startsWith("file://") ? raw.slice("file://".length) : raw;
  const root = REPO_ROOTS.exec(path);
  if (root) return path.slice(root.index + 1).replaceAll("\\", "/");
  return MACHINE_ROOTS.test(path) ? "[path]" : raw;
}

/** A run of the characters hex and base64 (URL-safe too) are written with. */
const BLOB_RUN = /[A-Za-z0-9+_=-]{32,}/g;

/**
 * Long opaque blobs, read run by run: a hex digest (32 characters or more),
 * or a base64 run of 40 or more with a digit and a letter, unless it is a
 * path's segment. Each run is read once, so a huge one costs its length.
 */
function redactBlobs(text: string): string {
  BLOB_RUN.lastIndex = 0;
  return text.replace(BLOB_RUN, (run: string, offset: number) => {
    let end = run.length;
    while (end > 0 && run.charCodeAt(end - 1) === 61 /* = */) end -= 1;
    const body = run.slice(0, end);
    if (body.length >= 32 && /^[0-9a-f]+$/i.test(body)) return REDACTED;
    if (body.length < 40 || text.charAt(offset - 1) === "/") return run;
    return /\d/.test(body) && /[A-Za-z]/.test(body) ? REDACTED : run;
  });
}

/**
 * `text` cut to `max` characters, without a word the cut split: what is
 * left of a token is no token any pattern knows.
 */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"), head.lastIndexOf("\t"));
  return `${space > 0 ? head.slice(0, space) : ""}…`;
}

/** `text` without the personal data and secrets it may hold, cut to `max` characters first. */
export function sanitizeText(text: string, max = MESSAGE_MAX): string {
  const clean = redactBlobs(
    RULES.reduce(
      (result, [pattern, replacement]) => {
        pattern.lastIndex = 0;
        return result.replace(pattern, replacement as string);
      },
      redactHandoffSecrets(cut(text, max)),
    ),
  );
  // A replacement can be longer than what it replaced.
  return clean.length > max + REDACTED.length ? clean.slice(0, max) : clean;
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

/**
 * An error's code as it may be kept: a short code (`ER_DUP_ENTRY`, `ENOENT`,
 * `card_declined`, `StripeCardError`, `1062`), anything else dropped.
 */
export function sanitizeCode(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : undefined;
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

/** The names a MySQL message gives, each read where only a name stands (the values stay out). */
const SQL_NAMES: ReadonlyArray<readonly [string, RegExp]> = [
  ["key", /\bfor key '([\w.$-]{1,128})'$/],
  ["column", /\bfor column '([\w$]{1,64})'(?: at row \d+)?$/],
  ["column", /^Column '([\w$]{1,64})' cannot be null$/],
  ["column", /^Field '([\w$]{1,64})' doesn't have a default value$/],
  ["column", /^Unknown column '([\w$.]{1,128})' in '[\w ]{1,40}'$/],
  ["constraint", /\bCONSTRAINT `([\w$]{1,64})`/],
  ["table", /^Table '([\w$.]{1,128})' doesn't exist$/],
];

/**
 * A MySQL error (mysql2: `code` ER_…, `errno`, `sqlMessage`) as its code and
 * the names its message gives, never the message, which quotes values.
 */
function sqlMessageOf(error: Error): string | null {
  const code = Reflect.get(error, "code");
  if (typeof code !== "string" || !/^(?:ER|WARN)_[A-Z0-9_]{1,60}$/.test(code)) return null;
  // A message MySQL wrote: what it quotes is a value, so only the names it gives are kept.
  const errno = Reflect.get(error, "errno");
  const sqlMessage = Reflect.get(error, "sqlMessage");
  if (typeof errno !== "number" && typeof sqlMessage !== "string") return null;
  const text = cut(typeof sqlMessage === "string" ? sqlMessage : error.message, 2_000);
  const names = SQL_NAMES.flatMap(([kind, pattern]) => {
    const found = pattern.exec(text)?.[1];
    return found ? [`${kind} ${found}`] : [];
  });
  return `${code}${typeof errno === "number" ? ` (${errno})` : ""}${names.length > 0 ? `: ${names.join(", ")}` : ""}`;
}

/** Drizzle's failed query: its SQL with no literal, and its parameters' place, not their values. */
function failedQueryOf(message: string): string | null {
  if (!message.startsWith("Failed query: ")) return null;
  const end = message.indexOf("\nparams:");
  const query = cut(message.slice(0, end < 0 ? undefined : end), MESSAGE_MAX).replace(
    /'(?:[^'\\\n]|\\.|''){0,2000}(?:'|$)/g,
    `'${REDACTED}'`,
  );
  return `${sanitizeText(query)}${end < 0 ? "" : `\nparams: ${REDACTED}`}`;
}

/** A validation error (Zod's `issues`, also under oRPC's): each issue's code and path only. */
function issuesMessageOf(error: Error): string | null {
  const issues = Reflect.get(error, "issues");
  if (!Array.isArray(issues)) return null;
  const described = issues.slice(0, ISSUES_MAX).map((issue: unknown) => {
    const code = issue && typeof issue === "object" ? Reflect.get(issue, "code") : undefined;
    const path = issue && typeof issue === "object" ? Reflect.get(issue, "path") : undefined;
    const name = typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : "issue";
    const at = Array.isArray(path)
      ? path
          .slice(0, 10)
          .map((part) =>
            typeof part === "number" || (typeof part === "string" && /^[\w$-]{1,64}$/.test(part))
              ? String(part)
              : "[key]",
          )
          .join(".")
      : "";
    return at ? `${name} at ${at}` : name;
  });
  const more = issues.length > ISSUES_MAX ? ` (+${issues.length - ISSUES_MAX} more)` : "";
  return `Invalid input: ${described.join("; ") || "no issue"}${more}`;
}

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
    .split("\n", 200)
    .filter((line) => /^\s+at /.test(line))
    .slice(0, options.frames ?? FRAMES_MAX)
    .map((line) => sanitizeText(line.trim(), 300));
  const code = sanitizeCode(Reflect.get(error, "code"));
  const type = sanitizeCode(Reflect.get(error, "type"));
  const cause = Reflect.get(error, "cause");
  const message =
    sqlMessageOf(error) ??
    issuesMessageOf(error) ??
    failedQueryOf(String(error.message)) ??
    sanitizeText(String(error.message));
  return {
    name: sanitizeText(String(error.name), 100),
    message,
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
