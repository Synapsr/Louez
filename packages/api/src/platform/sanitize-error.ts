import { REDACTED } from "./redact";

/**
 * Errors as facts safe to log or send to an error tracker. An error's
 * message may carry anything a request held, so free text is read by an
 * allowlist: after it is cut, it is scanned once, and only plain words,
 * punctuation and code-like words (`ER_DUP_ENTRY`) stay. Everything else
 * becomes a typed placeholder: a quoted segment or an unknown token
 * `[value]`, a file path `[path]`, a URL its scheme and host then `[url]`,
 * and what follows a sensitive key (cookie, authorization, password,
 * token…) up to its line's end `[redacted]`.
 *
 * Structured errors keep more, read where the structure says: a MySQL
 * error its code and the name its message gives at its known place, a
 * validation error its issues' codes and paths (static keys only), a stack
 * its frames' functions and repository paths. `sanitizeError` never throws
 * and never returns the error object, nor a property outside its list.
 */

/** Longest message kept: the text is cut to it before it is read. */
const MESSAGE_MAX = 1_000;
/** Stack frames kept by default. */
const FRAMES_MAX = 10;
/** Causes followed at most. */
const CAUSE_DEPTH = 3;
/** Validation issues kept at most. */
const ISSUES_MAX = 20;

const VALUE = "[value]";
const PATH = "[path]";
const URL_PLACEHOLDER = "[url]";

// --- Free text ---------------------------------------------------------------

/** A plain word: letters (accented included), an apostrophe inside, 24 at most. */
const PLAIN_WORD = /^\p{L}(?:\p{L}|'(?=\p{L})){0,23}$/u;
/**
 * A code of a known family: MySQL's (`ER_DUP_ENTRY`, `WARN_DATA_TRUNCATED`),
 * Node's (`ERR_INVALID_ARG_TYPE`, `ENOENT`) and the HTTP ones oRPC names.
 * Any other capitals with underscores may be a value (`FAKE_TOKEN`).
 */
const CODE_WORD =
  /^(?:(?:ER|WARN|ERR)_[A-Z0-9]{1,20}(?:_[A-Z0-9]{1,20}){0,6}|E[A-Z]{3,15}|BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|METHOD_NOT_SUPPORTED|NOT_ACCEPTABLE|TIMEOUT|CONFLICT|PRECONDITION_FAILED|PAYLOAD_TOO_LARGE|UNSUPPORTED_MEDIA_TYPE|UNPROCESSABLE_CONTENT|TOO_MANY_REQUESTS|CLIENT_CLOSED_REQUEST|INTERNAL_SERVER_ERROR|NOT_IMPLEMENTED|BAD_GATEWAY|SERVICE_UNAVAILABLE|GATEWAY_TIMEOUT)$/;
/** A token made of punctuation only, which carries no value. */
const PUNCTUATION_ONLY = /^[-–—*#|&=+~^.!?:]{1,3}$/;
const SCHEME = /^[a-z][a-z0-9+.-]{0,15}$/i;
const HOST = /^[A-Za-z0-9.-]{1,253}(?::\d{1,5})?$/;
const PATH_START = /^(?:\/|~\/|\.\.?\/|[A-Za-z]:[\\/]|file:\/\/)/;

/** Last words of a key whose value is secret, letters only and lower-cased (`x-api-key`: `xapikey`). */
const SENSITIVE_ENDINGS = [
  "cookie",
  "cookies",
  "authorization",
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "secrets",
  "token",
  "tokens",
  "apikey",
  "bearer",
  "privatekey",
  "otp",
  "sessionid",
  "credential",
  "credentials",
  "signature",
  "jwt",
];

function isSensitiveName(name: string): boolean {
  if (name.length === 0 || name.length > 40) return false;
  const letters = name.toLowerCase().replace(/[^a-z]/g, "");
  return letters.length > 0 && SENSITIVE_ENDINGS.some((ending) => letters.endsWith(ending));
}

const isNewline = (ch: string) => ch === "\n" || ch === "\r";
const isBlank = (ch: string) =>
  ch === " " || ch === "\t" || ch === "\f" || ch === "\v" || ch === " ";
const isLetterOrDigit = (ch: string) => ch !== "" && /[\p{L}\p{N}]/u.test(ch);
/** Brackets and separators stand alone, as punctuation. */
const STANDALONE = new Set(["(", ")", "[", "]", "{", "}", "<", ">", ",", ";"]);

/** Whether a quote opens a segment here: `'` only outside a word (`doesn't` stays a word). */
function opensQuote(text: string, index: number): boolean {
  const ch = text.charAt(index);
  if (ch === '"' || ch === "`") return true;
  return ch === "'" && !isLetterOrDigit(text.charAt(index - 1));
}

/** Where the segment a quote at `start` opens ends (its closing quote), or the text's end. */
function closingQuote(text: string, start: number): number {
  const quote = text.charAt(start);
  for (let index = start + 1; index < text.length; index += 1) {
    const ch = text.charAt(index);
    if (ch === "\\") {
      index += 1;
      continue;
    }
    if (ch !== quote) continue;
    // `'O'Brien'`: a quote between two letters is an apostrophe.
    if (
      quote === "'" &&
      isLetterOrDigit(text.charAt(index - 1)) &&
      /\p{L}/u.test(text.charAt(index + 1))
    ) {
      continue;
    }
    return index;
  }
  return text.length;
}

/** A URL as its scheme and host, the rest a placeholder; `file://` is a path. */
function describeUrl(token: string): string {
  const at = token.indexOf("://");
  const scheme = token.slice(0, at);
  if (!SCHEME.test(scheme)) return VALUE;
  if (scheme.toLowerCase() === "file") return PATH;
  const rest = token.slice(at + 3);
  const end = rest.search(/[/?#]/);
  const authority = end < 0 ? rest : rest.slice(0, end);
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return HOST.test(host)
    ? `${scheme}://${host}${URL_PLACEHOLDER}`
    : `${scheme}://${URL_PLACEHOLDER}`;
}

/**
 * Past a sensitive key: the separator, blanks and line breaks, then its
 * value, a quoted one whole (across lines), and what is left of that line.
 * Returns where reading goes on, and whether anything was skipped.
 */
function skipSecret(text: string, from: number): { next: number; skipped: boolean } {
  let index = from;
  while (index < text.length) {
    const ch = text.charAt(index);
    if (isBlank(ch) || isNewline(ch) || ch === ":" || ch === "=") index += 1;
    else break;
  }
  if (index >= text.length) return { next: index, skipped: false };
  if (opensQuote(text, index)) index = Math.min(closingQuote(text, index) + 1, text.length);
  while (index < text.length && !isNewline(text.charAt(index))) index += 1;
  return { next: index, skipped: true };
}

/** What a token stands for: itself when it is a plain word, a code or punctuation. */
function describeToken(core: string): string {
  if (core.includes("://")) return describeUrl(core);
  if (PATH_START.test(core) || /[\\/]/.test(core)) return PATH;
  if (PLAIN_WORD.test(core) || CODE_WORD.test(core) || PUNCTUATION_ONLY.test(core)) return core;
  return VALUE;
}

/** `text` cut to `max`, without the word the cut split. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"), head.lastIndexOf("\t"));
  return `${space > 0 ? head.slice(0, space) : ""} …`;
}

/**
 * `text` as its shape: plain words, punctuation and codes as they are,
 * everything else a placeholder (see the module's comment). Cut to `max`
 * characters first, then read once.
 */
export function sanitizeText(text: string, max = MESSAGE_MAX): string {
  if (typeof text !== "string") return VALUE;
  const input = cut(text, max);
  const pieces: string[] = [];
  let gap: "" | " " | "\n" = "";
  const emit = (piece: string, glued = false) => {
    if (!piece) return;
    // One placeholder for a run of them (a spaced phone number, a split blob).
    if (gap !== "\n" && pieces.at(-1) === piece && /^\[[a-z]+\]$/.test(piece)) {
      gap = "";
      return;
    }
    if (pieces.length > 0 && gap && !glued) pieces.push(gap);
    pieces.push(piece);
    gap = "";
  };

  let index = 0;
  while (index < input.length) {
    const ch = input.charAt(index);
    if (isNewline(ch)) {
      gap = "\n";
      index += 1;
      continue;
    }
    if (isBlank(ch)) {
      if (gap !== "\n") gap = " ";
      index += 1;
      continue;
    }
    if (opensQuote(input, index)) {
      const close = closingQuote(input, index);
      const content = input.slice(index + 1, close);
      index = Math.min(close + 1, input.length);
      if (/^[\w-]{1,40}$/.test(content) && isSensitiveName(content)) {
        // `"cookie": "…"`: the key stays, its value and its line go.
        emit(`${ch}${content}${ch}`);
        const secret = skipSecret(input, index);
        if (secret.skipped) emit(`: ${REDACTED}`, true);
        index = secret.next;
      } else {
        emit(PATH_START.test(content) ? PATH : VALUE);
      }
      continue;
    }
    if (STANDALONE.has(ch)) {
      emit(ch);
      index += 1;
      continue;
    }
    let end = index;
    while (
      end < input.length &&
      !isBlank(input.charAt(end)) &&
      !isNewline(input.charAt(end)) &&
      !STANDALONE.has(input.charAt(end)) &&
      !opensQuote(input, end)
    ) {
      end += 1;
    }
    const token = input.slice(index, end);
    index = end;
    // Trailing punctuation ends a sentence or names a field (`token:`).
    let coreEnd = token.length;
    while (coreEnd > 0 && ".:!?".includes(token.charAt(coreEnd - 1))) coreEnd -= 1;
    const core = token.slice(0, coreEnd);
    const trail = token.slice(coreEnd);
    if (!core) {
      emit(PUNCTUATION_ONLY.test(trail) ? trail : VALUE);
      continue;
    }
    // `key=value`, `key:value`: a sensitive key hides the rest of its line.
    const separator = core.includes("://") ? -1 : core.search(/[:=]/);
    if (separator > 0 && isSensitiveName(core.slice(0, separator))) {
      const key = core.slice(0, separator);
      emit(PLAIN_WORD.test(key) || CODE_WORD.test(key) ? key : VALUE);
      let next = index;
      // The value after the separator, or past blanks and line breaks when the token ends there.
      if (separator === core.length - 1 && !trail) next = skipSecret(input, index).next;
      while (next < input.length && !isNewline(input.charAt(next))) next += 1;
      emit(`${core.charAt(separator)} ${REDACTED}`, true);
      index = next;
      continue;
    }
    if (/^[A-Za-z-]{1,40}$/.test(core) && isSensitiveName(core)) {
      // `Authorization: …`, `Bearer …`, `password\n…`.
      emit(`${core}${trail}`);
      const secret = skipSecret(input, index);
      if (secret.skipped) {
        gap = " ";
        emit(REDACTED);
      }
      index = secret.next;
      continue;
    }
    const described = describeToken(core);
    emit(`${described}${trail}`);
  }
  const clean = pieces.join("");
  return clean.length > max + 40 ? clean.slice(0, max) : clean;
}

// --- Codes and frames ---------------------------------------------------------

/**
 * An error's code as it may be kept: a short code (`ER_DUP_ENTRY`, `ENOENT`,
 * `card_declined`, `StripeCardError`, `1062`), anything else dropped.
 */
export function sanitizeCode(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : undefined;
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

/** Where a path inside the repository starts: what precedes it is the machine's. */
const REPO_ROOT = /[/\\](apps|packages|node_modules|docs|scripts)[/\\]/;
const REPO_PATH = /^[\w@.+\-/()[\]]{1,300}$/;
const FUNCTION_NAME = /^[\w$.<>[\] ]{1,120}$/;

/** A file in a frame, from the repository's root; `[path]` outside it or when it holds more than a path. */
function framePath(raw: string): string {
  if (/^(?:node:[\w/.-]{1,100}|index \d{1,6}|<anonymous>|native)$/.test(raw)) return raw;
  const path = raw.startsWith("file://") ? raw.slice("file://".length) : raw;
  const root = REPO_ROOT.exec(path);
  if (!root) return PATH;
  const relative = path.slice(root.index + 1).replaceAll("\\", "/");
  return REPO_PATH.test(relative) ? relative : PATH;
}

/**
 * A stack frame as its function and place: `at fn (packages/…/x.ts:12:3)`.
 * Read by position, not by patterns over its text; what it cannot read is
 * `[function]`, `[path]` or `at [frame]`.
 */
export function sanitizeFrame(line: string): string {
  if (typeof line !== "string") return "at [frame]";
  const frame = line.trim().slice(0, 600);
  if (!frame.startsWith("at ")) return "at [frame]";
  const body = frame.slice(3);
  const open = body.indexOf(" (");
  const withName = open > 0 && body.endsWith(")");
  const name = withName ? body.slice(0, open) : "";
  const location = withName ? body.slice(open + 2, -1) : body;
  const column = location.lastIndexOf(":");
  const row = column > 0 ? location.lastIndexOf(":", column - 1) : -1;
  const numbered =
    row > 0 &&
    /^\d{1,7}$/.test(location.slice(row + 1, column)) &&
    /^\d{1,7}$/.test(location.slice(column + 1));
  const place = numbered
    ? `${framePath(location.slice(0, row))}${location.slice(row)}`
    : framePath(location);
  if (!withName) return `at ${place}`;
  return `at ${FUNCTION_NAME.test(name) ? name : "[function]"} (${place})`;
}

// --- Structured errors ----------------------------------------------------------

/** A property, or undefined when reading it throws (a getter, a revoked proxy). */
function read(target: unknown, key: string): unknown {
  if ((typeof target !== "object" && typeof target !== "function") || target === null) {
    return undefined;
  }
  try {
    return Reflect.get(target, key);
  } catch {
    return undefined;
  }
}

/**
 * MySQL's messages, by code, each read whole and anchored: a name is taken
 * only where the message puts it, never from the value it quotes.
 */
const SQL_PARSERS: Readonly<Record<string, readonly [string, RegExp]>> = {
  ER_DUP_ENTRY: ["key", /^Duplicate entry '[\s\S]*' for key '([\w$]{1,64}(?:\.[\w$]{1,64})?)'$/],
  ER_DATA_TOO_LONG: ["column", /^Data too long for column '([\w$]{1,64})' at row \d{1,10}$/],
  ER_BAD_NULL_ERROR: ["column", /^Column '([\w$]{1,64})' cannot be null$/],
  ER_NO_DEFAULT_FOR_FIELD: ["column", /^Field '([\w$]{1,64})' doesn't have a default value$/],
  ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: [
    "column",
    /^Incorrect [a-z ]{1,40} value: '[\s\S]*' for column (?:`[\w$]{1,64}`\.){0,2}'([\w$]{1,64})' at row \d{1,10}$/,
  ],
  WARN_DATA_TRUNCATED: ["column", /^Data truncated for column '([\w$]{1,64})' at row \d{1,10}$/],
  ER_BAD_FIELD_ERROR: [
    "column",
    /^Unknown column '([\w$]{1,64}(?:\.[\w$]{1,64})?)' in '[a-z ]{1,40}'$/,
  ],
  ER_NO_SUCH_TABLE: ["table", /^Table '([\w$]{1,64}(?:\.[\w$]{1,64})?)' doesn't exist$/],
  ER_NO_REFERENCED_ROW_2: [
    "constraint",
    /^Cannot add or update a child row: a foreign key constraint fails \(`[\w$]{1,64}`\.`[\w$]{1,64}`, CONSTRAINT `([\w$]{1,64})` FOREIGN KEY [^']{0,600}\)$/,
  ],
  ER_ROW_IS_REFERENCED_2: [
    "constraint",
    /^Cannot delete or update a parent row: a foreign key constraint fails \(`[\w$]{1,64}`\.`[\w$]{1,64}`, CONSTRAINT `([\w$]{1,64})` FOREIGN KEY [^']{0,600}\)$/,
  ],
};

/**
 * A MySQL error (mysql2: `code` ER_…, `errno`, `sqlMessage`) as its code,
 * its number and the name its message gives at its known place; the
 * message itself, which quotes values, never.
 */
function sqlMessageOf(error: object): string | null {
  const code = read(error, "code");
  if (typeof code !== "string" || !/^(?:ER|WARN)_[A-Z0-9_]{1,60}$/.test(code)) return null;
  const errno = read(error, "errno");
  const sqlMessage = read(error, "sqlMessage");
  if (typeof errno !== "number" && typeof sqlMessage !== "string") return null;
  const message = read(error, "message");
  const number = typeof errno === "number" && Number.isSafeInteger(errno) ? ` (${errno})` : "";
  const parser = Object.hasOwn(SQL_PARSERS, code) ? SQL_PARSERS[code] : undefined;
  const text =
    typeof sqlMessage === "string" ? sqlMessage : typeof message === "string" ? message : "";
  const name = parser && text.length <= 4_000 ? parser[1].exec(text)?.[1] : undefined;
  return `${code}${number}${parser && name ? `: ${parser[0]} ${name}` : ""}`;
}

/** Drizzle's failed query: its SQL as its shape, its parameters' place only. */
function failedQueryOf(message: string): string | null {
  if (!message.startsWith("Failed query: ")) return null;
  const end = message.indexOf("\nparams:");
  const query = message.slice("Failed query: ".length, end < 0 ? undefined : end);
  return `Failed query: ${sanitizeText(query)}${end < 0 ? "" : `\nparams: ${REDACTED}`}`;
}

/**
 * The keys a validation path may name: the API's static field names. A key
 * outside it (a record's own key, which a user or a caller chose) is `[key]`.
 */
const PATH_KEYS: ReadonlySet<string> = new Set([
  "id",
  "ids",
  "storeId",
  "store",
  "items",
  "item",
  "input",
  "cursor",
  "limit",
  "status",
  "type",
  "kind",
  "mode",
  "name",
  "title",
  "slug",
  "description",
  "email",
  "phone",
  "firstName",
  "lastName",
  "companyName",
  "address",
  "city",
  "postalCode",
  "country",
  "customer",
  "customerId",
  "product",
  "productId",
  "products",
  "reservation",
  "reservationId",
  "unit",
  "unitId",
  "units",
  "variant",
  "variants",
  "values",
  "value",
  "price",
  "prices",
  "amount",
  "currency",
  "quantity",
  "startDate",
  "endDate",
  "date",
  "dates",
  "notes",
  "note",
  "reason",
  "message",
  "settings",
  "businessHours",
  "schedule",
  "ranges",
  "openTime",
  "closeTime",
  "closurePeriods",
  "delivery",
  "locations",
  "location",
  "taxes",
  "attributes",
  "metadata",
  "options",
  "url",
  "imageUrl",
  "images",
  "locale",
  "timezone",
  "permissions",
  "role",
  "occurredAt",
  "confirmationToken",
]);

/** A validation error (Zod's `issues`, also under oRPC's): each issue's code and path only. */
function issuesMessageOf(issues: readonly unknown[]): string {
  const described = issues.slice(0, ISSUES_MAX).map((issue) => {
    const code = read(issue, "code");
    const path = read(issue, "path");
    const name = typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : "issue";
    const at = Array.isArray(path)
      ? path
          .slice(0, 10)
          .map((part: unknown) =>
            typeof part === "number" && Number.isSafeInteger(part)
              ? String(part)
              : typeof part === "string" && PATH_KEYS.has(part)
                ? part
                : "[key]",
          )
          .join(".")
      : "";
    return at ? `${name} at ${at}` : name;
  });
  const more = issues.length > ISSUES_MAX ? ` (+${issues.length - ISSUES_MAX} more)` : "";
  return `Invalid input: ${described.join("; ") || "no issue"}${more}`;
}

/** An error as it may be logged or reported: allowlisted fields, each sanitized. */
export interface SanitizedError {
  name: string;
  message: string;
  /** A provider's or a driver's codes (`code`, Stripe's `type`, an HTTP `statusCode`). */
  code?: string;
  type?: string;
  statusCode?: number;
  /** The stack's frames (`sanitizeFrame`), without the message the stack starts with. */
  frames: string[];
  cause?: SanitizedError;
}

function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function kindOf(value: unknown): string {
  try {
    const tag = Object.prototype.toString.call(value).slice(8, -1).toLowerCase();
    return /^[a-z]{1,20}$/.test(tag) ? tag : typeof value;
  } catch {
    return typeof value;
  }
}

function sanitizeOne(
  error: unknown,
  options: { frames?: number },
  depth: number,
  seen: Set<object>,
): SanitizedError {
  if (typeof error === "string") {
    return { name: "NonError", message: sanitizeText(error), frames: [] };
  }
  if (!isError(error)) {
    return { name: "NonError", message: `a thrown ${kindOf(error)}`, frames: [] };
  }
  seen.add(error);
  const rawName = read(error, "name");
  const name =
    typeof rawName === "string" && /^[A-Za-z][\w$.]{0,60}$/.test(rawName) ? rawName : "Error";
  const rawMessage = read(error, "message");
  const issues = read(error, "issues");
  const message =
    sqlMessageOf(error) ??
    (Array.isArray(issues) ? issuesMessageOf(issues) : null) ??
    (typeof rawMessage === "string"
      ? (failedQueryOf(rawMessage) ?? sanitizeText(rawMessage))
      : rawMessage === undefined
        ? ""
        : VALUE);
  const stack = read(error, "stack");
  const frames =
    typeof stack === "string"
      ? stack
          .split("\n", 200)
          .filter((line) => /^\s+at /.test(line))
          .slice(0, options.frames ?? FRAMES_MAX)
          .map(sanitizeFrame)
      : [];
  const code = sanitizeCode(read(error, "code"));
  const type = sanitizeCode(read(error, "type"));
  const statusCode = read(error, "statusCode");
  const cause = read(error, "cause");
  let causeFacts: SanitizedError | undefined;
  if (cause !== undefined && cause !== null && depth < CAUSE_DEPTH) {
    causeFacts =
      typeof cause === "object" && seen.has(cause)
        ? { name: "Error", message: "[cause cycle]", frames: [] }
        : sanitizeOne(cause, options, depth + 1, seen);
  }
  return {
    name,
    message,
    ...(code === undefined ? {} : { code }),
    ...(type === undefined ? {} : { type }),
    ...(typeof statusCode === "number" && Number.isSafeInteger(statusCode) ? { statusCode } : {}),
    frames,
    ...(causeFacts ? { cause: causeFacts } : {}),
  };
}

/**
 * `error` as a `SanitizedError`: never its own object, nor a property
 * outside the list, and never a throw: a field it cannot read is left out,
 * and an error it cannot read at all is `[unreadable error]`.
 */
export function sanitizeError(error: unknown, options: { frames?: number } = {}): SanitizedError {
  try {
    return sanitizeOne(error, options, 0, new Set());
  } catch {
    return { name: "Error", message: "[unreadable error]", frames: [] };
  }
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
