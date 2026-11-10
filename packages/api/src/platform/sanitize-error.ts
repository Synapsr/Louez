import { REDACTED } from "./redact";

/**
 * Errors as facts safe to log or send to an error tracker. No free text a
 * third party wrote reaches them: a message is kept only from Louez's own
 * templated errors (`markTemplated`: `apiError`, `ApiServiceError`), and
 * even then read as its shape, so a value put into the template is a
 * placeholder. Every other message is `[message withheld]`, unless its
 * structure says more: a MySQL error its code, number and the name its
 * message gives at its known place, a failed query its SQL's shape, a
 * validation error its issues' codes and static paths. Names and codes are
 * kept from known vocabularies only (`[name]`, `[code]` otherwise), and a
 * stack's frames keep their functions and places from the repository's
 * root, which are code. `sanitizeError` never throws and never returns the
 * error object, nor a property outside its list.
 *
 * `sanitizeText` is for the few callers that must log a text: best effort,
 * it keeps the text's shape and drops all that follows a key. A word made
 * of letters only (a name, a letter-only secret) stays, which is why
 * errors carry no message of their own: prefer structured fields.
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
const WITHHELD = "[message withheld]";

// --- Louez's own errors ------------------------------------------------------

/** Set on Louez's templated errors: their message is a template of Louez's code. */
const LOUEZ_TEMPLATE = Symbol.for("louez.templatedError");

/** Marks `error` as one of Louez's templated errors, whose message `sanitizeError` keeps. */
export function markTemplated<T extends object>(error: T): T {
  try {
    Object.defineProperty(error, LOUEZ_TEMPLATE, { value: true, enumerable: false });
  } catch {
    // A frozen error stays unmarked: its message is withheld.
  }
  return error;
}

// --- Free text ---------------------------------------------------------------

/** A plain word: letters (accented included), an apostrophe inside, 24 at most. */
const PLAIN_WORD = /^\p{L}(?:\p{L}|'(?=\p{L})){0,23}$/u;
/** A token made of punctuation only, which carries no value. */
const PUNCTUATION_ONLY = /^[-–—*#|&=+~^.!?:]{1,3}$/;
const SCHEME = /^[a-z][a-z0-9+.-]{0,15}$/i;
const URL_START = /^[a-z][a-z0-9+.-]{0,15}:\/\//i;
const HOST = /^[A-Za-z0-9.-]{1,253}(?::\d{1,5})?$/;
const PATH_START = /^(?:\/|~\/|\.\.?\/|[A-Za-z]:[\\/]|file:\/\/)/;

/** Last words of a key whose value is secret even without a separator (`Bearer …`). */
const SENSITIVE_ENDINGS = [
  "cookie",
  "authorization",
  "password",
  "passwd",
  "pwd",
  "pass",
  "passphrase",
  "secret",
  "token",
  "apikey",
  "bearer",
  "basic",
  "privatekey",
  "otp",
  "session",
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

const words = (list: string) => list.split(/\s+/).filter(Boolean);

/** The words a SQL query's shape keeps: its keywords. */
const SQL_KEYWORDS: ReadonlySet<string> = new Set(
  words(`select insert update delete replace from where and or not in is null into values value set
    join left right inner outer cross on as order by group having limit offset asc desc distinct
    count max min sum avg exists case when then else end like between cast binary union all for
    lock share with returning default true false interval second minute hour day week month year
    coalesce if ifnull nullif duplicate key ignore using straight_join date_format now json_extract
    json_unquote`),
);

const isNewline = (ch: string) => ch === "\n" || ch === "\r";
const isBlank = (ch: string) =>
  ch === " " || ch === "\t" || ch === "\f" || ch === "\v" || ch === "\u00a0";
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
  const end = rest.search(/[/?#,;]/);
  const authority = end < 0 ? rest : rest.slice(0, end);
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return HOST.test(host)
    ? `${scheme}://${host}${URL_PLACEHOLDER}`
    : `${scheme}://${URL_PLACEHOLDER}`;
}

/** Where the next character that is no blank nor line break stands. */
function nextVisible(text: string, from: number): number {
  let index = from;
  while (index < text.length && (isBlank(text.charAt(index)) || isNewline(text.charAt(index)))) {
    index += 1;
  }
  return index;
}

/** `text` cut to `max`, without the word the cut split. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"), head.lastIndexOf("\t"));
  return `${space > 0 ? head.slice(0, space) : ""} …`;
}

/**
 * Reads `input` once and writes its shape. In `text` mode, plain words stay
 * and the first key followed by `:` or `=` (or a sensitive word such as
 * `Bearer`) ends the text with `[redacted]`. In `sql` mode, only SQL's
 * keywords and operators stay, and nothing ends it.
 */
function shapeOf(input: string, mode: "text" | "sql"): string {
  const pieces: string[] = [];
  let gap: "" | " " | "\n" = "";
  const emit = (piece: string) => {
    if (!piece) return;
    // One placeholder for a run of them (a spaced phone number, a split blob).
    if (gap !== "\n" && pieces.at(-1) === piece && /^\[[a-z]+\]$/.test(piece)) {
      gap = "";
      return;
    }
    if (pieces.length > 0 && gap) pieces.push(gap);
    pieces.push(piece);
    gap = "";
  };
  const followed = (at: number) => nextVisible(input, at) < input.length;
  /** Ends the text after a key: its separator, then `[redacted]` when anything follows. */
  const endAfterKey = (separator: string, at: number, spaced = false) => {
    const mark = `${spaced ? " " : ""}${separator}`;
    pieces.push(followed(at) ? `${mark} ${REDACTED}` : mark);
    return pieces.join("");
  };
  const keyShape = (key: string) => (PLAIN_WORD.test(key) ? key : VALUE);

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
      emit(mode === "text" && PATH_START.test(content) ? PATH : VALUE);
      if (mode === "text") {
        const after = nextVisible(input, index);
        const separator = input.charAt(after);
        // `"key": …`, `'key' = …`: the key ends the text.
        if (separator === ":" || separator === "=") {
          return endAfterKey(separator, after + 1, after > index);
        }
      }
      continue;
    }
    if (STANDALONE.has(ch)) {
      emit(ch);
      index += 1;
      continue;
    }
    // A URL runs to a blank or a quote, its commas and semicolons included.
    if (URL_START.test(input.slice(index, index + 20))) {
      let end = index;
      while (
        end < input.length &&
        !isBlank(input.charAt(end)) &&
        !isNewline(input.charAt(end)) &&
        !"\"'`<>".includes(input.charAt(end))
      ) {
        end += 1;
      }
      emit(describeUrl(input.slice(index, end)));
      index = end;
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
    if (mode === "sql") {
      if (SQL_KEYWORDS.has(core.toLowerCase())) emit(`${core}${trail}`);
      else emit(`${PUNCTUATION_ONLY.test(core) ? core : VALUE}${trail}`);
      continue;
    }
    // A path, its query included, is a path.
    if (PATH_START.test(core)) {
      emit(`${PATH}${trail}`);
      continue;
    }
    // `key=value`, `key:value`: the key ends the text.
    const separator = core.search(/[:=]/);
    if (separator > 0) {
      emit(keyShape(core.slice(0, separator)));
      pieces.push(`${core.charAt(separator)} ${REDACTED}`);
      return pieces.join("");
    }
    // `key: …`, `key = …`, `key\n: …`.
    if (trail.includes(":")) {
      emit(keyShape(core));
      return endAfterKey(":", index);
    }
    const after = nextVisible(input, index);
    if (input.charAt(after) === ":" || input.charAt(after) === "=") {
      emit(keyShape(core));
      return endAfterKey(input.charAt(after), after + 1, after > index);
    }
    // `Bearer …`, `password …`: a sensitive word ends the text.
    if (/^[A-Za-z_-]{1,40}$/.test(core) && isSensitiveName(core)) {
      emit(`${keyShape(core)}${trail}`);
      if (followed(index)) emit(REDACTED);
      return pieces.join("");
    }
    if (/[\\/]/.test(core)) emit(`${PATH}${trail}`);
    else if (PLAIN_WORD.test(core) || PUNCTUATION_ONLY.test(core) || KNOWN_CODES.has(core)) {
      emit(`${core}${trail}`);
    } else emit(`${VALUE}${trail}`);
  }
  return pieces.join("");
}

/**
 * Best effort, for a caller that must log a text: its shape (plain words,
 * punctuation; anything else a placeholder), cut to `max` characters first
 * and read once, with all that follows the first key (`key:`, `key=`) or a
 * sensitive word (`Bearer`) replaced by `[redacted]`. A word made of
 * letters only stays: prefer structured fields, or `sanitizeError`.
 */
export function sanitizeText(text: string, max = MESSAGE_MAX): string {
  if (typeof text !== "string") return VALUE;
  const clean = shapeOf(cut(text, max), "text");
  return clean.length > max + 40 ? clean.slice(0, max) : clean;
}

// --- Names and codes ----------------------------------------------------------

/** Error classes whose name says what failed. */
const KNOWN_NAMES: ReadonlySet<string> = new Set(
  words(`Error TypeError RangeError SyntaxError ReferenceError EvalError URIError AggregateError
    AbortError TimeoutError DOMException FetchError ORPCError ValidationError ZodError DrizzleError
    DrizzleQueryError TransactionRollbackError StripeError StripeCardError StripeInvalidRequestError
    StripeAPIError StripeAuthenticationError StripePermissionError StripeRateLimitError
    StripeConnectionError StripeSignatureVerificationError StripeIdempotencyError
    StripeInvalidGrantError StripeUnknownError APIError BetterAuthError ApiServiceError
    ReservationInventoryError ReservationProductsChangedError`),
);

/**
 * The codes an error may carry and a report may keep: HTTP's as oRPC names
 * them, MySQL's and mysql2's, Node's (errno and `ERR_…`) and undici's,
 * Stripe's error types and codes.
 */
const KNOWN_CODES: ReadonlySet<string> = new Set([
  ...words(`BAD_REQUEST UNAUTHORIZED FORBIDDEN NOT_FOUND METHOD_NOT_SUPPORTED NOT_ACCEPTABLE TIMEOUT
    CONFLICT PRECONDITION_FAILED PAYLOAD_TOO_LARGE UNSUPPORTED_MEDIA_TYPE UNPROCESSABLE_CONTENT
    TOO_MANY_REQUESTS CLIENT_CLOSED_REQUEST INTERNAL_SERVER_ERROR NOT_IMPLEMENTED BAD_GATEWAY
    SERVICE_UNAVAILABLE GATEWAY_TIMEOUT`),
  ...words(`ER_DUP_ENTRY ER_DUP_KEY ER_NO_SUCH_TABLE ER_BAD_FIELD_ERROR ER_BAD_NULL_ERROR
    ER_NO_DEFAULT_FOR_FIELD ER_DATA_TOO_LONG ER_TRUNCATED_WRONG_VALUE ER_TRUNCATED_WRONG_VALUE_FOR_FIELD
    WARN_DATA_TRUNCATED ER_WARN_DATA_OUT_OF_RANGE ER_NO_REFERENCED_ROW ER_NO_REFERENCED_ROW_2
    ER_ROW_IS_REFERENCED ER_ROW_IS_REFERENCED_2 ER_LOCK_DEADLOCK ER_LOCK_WAIT_TIMEOUT ER_LOCK_NOWAIT
    ER_PARSE_ERROR ER_ACCESS_DENIED_ERROR ER_DBACCESS_DENIED_ERROR ER_TABLEACCESS_DENIED_ERROR
    ER_BAD_DB_ERROR ER_CON_COUNT_ERROR ER_TOO_MANY_USER_CONNECTIONS ER_QUERY_INTERRUPTED
    ER_QUERY_TIMEOUT ER_CHECK_CONSTRAINT_VIOLATED ER_SIGNAL_EXCEPTION ER_DUP_FIELDNAME
    ER_WRONG_VALUE_COUNT_ON_ROW ER_NET_READ_INTERRUPTED ER_NET_PACKET_TOO_LARGE ER_SERVER_SHUTDOWN
    ER_OPTION_PREVENTS_STATEMENT ER_CANT_CREATE_TABLE ER_TABLE_EXISTS_ERROR ER_INVALID_JSON_TEXT
    ER_INVALID_JSON_TEXT_IN_PARAM ER_INVALID_JSON_PATH ER_SP_DOES_NOT_EXIST ER_NOT_SUPPORTED_YET
    ER_UNKNOWN_ERROR ER_TOO_LONG_KEY ER_WRONG_ARGUMENTS ER_OUT_OF_RESOURCES ER_CANT_LOCK
    ER_XAER_RMFAIL ER_WRONG_VALUE ER_INVALID_CAST ER_DIVISION_BY_ZERO PROTOCOL_CONNECTION_LOST
    PROTOCOL_SEQUENCE_TIMEOUT PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR PROTOCOL_PACKETS_OUT_OF_ORDER`),
  ...words(`ENOENT EACCES EPERM EEXIST EISDIR ENOTDIR ENOTEMPTY EMFILE ENFILE ENOSPC EROFS EBUSY
    EAGAIN EINVAL EPIPE ECONNREFUSED ECONNRESET ECONNABORTED ETIMEDOUT EHOSTUNREACH ENETUNREACH
    ENETDOWN ENOTFOUND EAI_AGAIN EAI_FAIL EADDRINUSE EADDRNOTAVAIL ENOMEM ENOTSUP ECANCELED ESRCH
    ENOSYS EPROTO ENOBUFS EINTR EIO`),
  ...words(`ERR_INVALID_ARG_TYPE ERR_INVALID_ARG_VALUE ERR_INVALID_URL ERR_OUT_OF_RANGE
    ERR_STREAM_PREMATURE_CLOSE ERR_STREAM_DESTROYED ERR_STREAM_WRITE_AFTER_END ERR_SOCKET_CLOSED
    ERR_HTTP_HEADERS_SENT ERR_INVALID_STATE ERR_UNHANDLED_REJECTION ERR_MODULE_NOT_FOUND
    ERR_REQUIRE_ESM ERR_UNKNOWN_FILE_EXTENSION ERR_INVALID_CHAR ERR_ASSERTION
    ERR_TLS_CERT_ALTNAME_INVALID ERR_INVALID_THIS ERR_METHOD_NOT_IMPLEMENTED ERR_INVALID_RETURN_VALUE
    ERR_STRING_TOO_LONG ERR_BUFFER_OUT_OF_BOUNDS ERR_INVALID_PROTOCOL ERR_HTTP2_STREAM_ERROR
    ERR_SSL_WRONG_VERSION_NUMBER ERR_OPERATION_FAILED ERR_INVALID_HTTP_TOKEN ERR_UNESCAPED_CHARACTERS
    UND_ERR_CONNECT_TIMEOUT UND_ERR_HEADERS_TIMEOUT UND_ERR_BODY_TIMEOUT UND_ERR_SOCKET
    UND_ERR_ABORTED UND_ERR_CLOSED UND_ERR_DESTROYED UND_ERR_REQ_CONTENT_LENGTH_MISMATCH
    UND_ERR_RESPONSE_STATUS_CODE ABORT_ERR`),
  ...words(`card_error invalid_request_error api_error idempotency_error rate_limit_error
    authentication_error invalid_grant StripeCardError StripeInvalidRequestError StripeAPIError
    StripeAuthenticationError StripePermissionError StripeRateLimitError StripeConnectionError
    StripeSignatureVerificationError StripeIdempotencyError StripeInvalidGrantError`),
  ...words(`account_closed account_country_invalid_address account_invalid account_number_invalid
    alipay_upgrade_required amount_too_large amount_too_small api_key_expired
    authentication_required balance_insufficient bank_account_declined bank_account_unusable
    card_decline_rate_limit_exceeded card_declined charge_already_captured charge_already_refunded
    charge_disputed charge_exceeds_source_limit charge_expired_for_capture country_unsupported
    coupon_expired customer_max_payment_methods email_invalid expired_card idempotency_key_in_use
    incorrect_address incorrect_cvc incorrect_number incorrect_zip insufficient_funds
    invalid_card_type invalid_charge_amount invalid_cvc invalid_expiry_month invalid_expiry_year
    invalid_number invalid_source_usage livemode_mismatch lock_timeout missing parameter_invalid_empty
    parameter_invalid_integer parameter_invalid_string_blank parameter_invalid_string_empty
    parameter_missing parameter_unknown payment_intent_action_required
    payment_intent_authentication_failure payment_intent_incompatible_payment_method
    payment_intent_payment_attempt_failed payment_intent_unexpected_state payment_method_unactivated
    payment_method_unexpected_state platform_api_key_expired processing_error rate_limit
    resource_already_exists resource_missing secret_key_required setup_intent_authentication_failure
    setup_intent_unexpected_state testmode_charges_only tls_version_unsupported url_invalid
    generic_decline do_not_honor fraudulent lost_card stolen_card pickup_card`),
]);

/**
 * An error's code as a report may keep it: one from the known vocabularies
 * (HTTP, MySQL, Node, undici, Stripe) or a safe integer; any other code is
 * `[code]`, and no code at all undefined.
 */
export function sanitizeCode(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : "[code]";
  if (typeof value !== "string" || value === "") return undefined;
  return KNOWN_CODES.has(value) ? value : "[code]";
}

// --- Frames --------------------------------------------------------------------

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
function read(target: unknown, key: string | symbol): unknown {
  if ((typeof target !== "object" && typeof target !== "function") || target === null) {
    return undefined;
  }
  try {
    return Reflect.get(target, key);
  } catch {
    return undefined;
  }
}

/** A schema object's name as Louez names them: lower snake case, a database's prefix allowed. */
const SCHEMA_NAME = "[a-z][a-z0-9_]{0,63}";
const QUALIFIED = `${SCHEMA_NAME}(?:\\.${SCHEMA_NAME})?`;

/**
 * MySQL's messages, by code, each read whole and anchored: a name is taken
 * only where the message puts it, and only when it reads as a schema
 * object's name; never from the value it quotes.
 */
const SQL_PARSERS: Readonly<Record<string, readonly [string, RegExp]>> = {
  ER_DUP_ENTRY: ["key", new RegExp(`^Duplicate entry '[\\s\\S]*' for key '(${QUALIFIED})'$`)],
  ER_DATA_TOO_LONG: [
    "column",
    new RegExp(`^Data too long for column '(${SCHEMA_NAME})' at row \\d{1,10}$`),
  ],
  ER_BAD_NULL_ERROR: ["column", new RegExp(`^Column '(${SCHEMA_NAME})' cannot be null$`)],
  ER_NO_DEFAULT_FOR_FIELD: [
    "column",
    new RegExp(`^Field '(${SCHEMA_NAME})' doesn't have a default value$`),
  ],
  ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: [
    "column",
    new RegExp(
      `^Incorrect [a-z ]{1,40} value: '[\\s\\S]*' for column (?:\`${SCHEMA_NAME}\`\\.){0,2}'(${SCHEMA_NAME})' at row \\d{1,10}$`,
    ),
  ],
  WARN_DATA_TRUNCATED: [
    "column",
    new RegExp(`^Data truncated for column '(${SCHEMA_NAME})' at row \\d{1,10}$`),
  ],
  ER_BAD_FIELD_ERROR: ["column", new RegExp(`^Unknown column '(${QUALIFIED})' in '[a-z ]{1,40}'$`)],
  ER_NO_SUCH_TABLE: ["table", new RegExp(`^Table '(${QUALIFIED})' doesn't exist$`)],
  ER_NO_REFERENCED_ROW_2: [
    "constraint",
    new RegExp(
      `^Cannot add or update a child row: a foreign key constraint fails \\(\`${SCHEMA_NAME}\`\\.\`${SCHEMA_NAME}\`, CONSTRAINT \`(${SCHEMA_NAME})\` FOREIGN KEY [^']{0,600}\\)$`,
    ),
  ],
  ER_ROW_IS_REFERENCED_2: [
    "constraint",
    new RegExp(
      `^Cannot delete or update a parent row: a foreign key constraint fails \\(\`${SCHEMA_NAME}\`\\.\`${SCHEMA_NAME}\`, CONSTRAINT \`(${SCHEMA_NAME})\` FOREIGN KEY [^']{0,600}\\)$`,
    ),
  ],
};

/**
 * A MySQL error (mysql2: `code` ER_…, `errno`, `sqlMessage`) as its code,
 * its number and the name its message gives at its known place; the
 * message itself, which quotes values, never.
 */
function sqlMessageOf(error: object): string | null {
  const code = read(error, "code");
  if (typeof code !== "string" || !KNOWN_CODES.has(code) || !/^(?:ER|WARN)_/.test(code)) {
    return null;
  }
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

/** Drizzle's failed query: its SQL's shape (keywords and operators), its parameters' place only. */
function failedQueryOf(message: string): string | null {
  if (!message.startsWith("Failed query: ")) return null;
  const end = message.indexOf("\nparams:");
  const query = cut(message.slice("Failed query: ".length, end < 0 ? undefined : end), MESSAGE_MAX);
  return `Failed query: ${shapeOf(query, "sql")}${end < 0 ? "" : `\nparams: ${REDACTED}`}`;
}

/**
 * The keys a validation path may name: the API's static field names. A key
 * outside it (a record's own key, which a user or a caller chose) is `[key]`.
 */
const PATH_KEYS: ReadonlySet<string> = new Set(
  words(`id ids storeId store items item input cursor limit status type kind mode name title slug
    description email phone firstName lastName companyName address city postalCode country customer
    customerId product productId products reservation reservationId unit unitId units variant
    variants values value price prices amount currency quantity startDate endDate date dates notes
    note reason message settings businessHours schedule ranges openTime closeTime closurePeriods
    delivery locations location taxes attributes metadata options url imageUrl images locale
    timezone permissions role occurredAt confirmationToken`),
);

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
  /** The error's class when it is a known one, else `[name]`. */
  name: string;
  /** Louez's template, a structure's facts, or `[message withheld]`. */
  message: string;
  /** Codes from known vocabularies (`code`, Stripe's `type`), else `[code]`. */
  code?: string;
  type?: string;
  /** A Louez error's own code (`data.code`: `CATEGORY_NOT_FOUND`). */
  apiCode?: string;
  statusCode?: number;
  errno?: number;
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

/** The message a report may keep: Louez's template, a structure's facts, or none. */
function messageOf(error: Error): string {
  if (read(error, LOUEZ_TEMPLATE) === true) {
    // An `ApiServiceError` names its translation key; `apiError` writes a sentence.
    const key = read(error, "key");
    if (typeof key === "string" && /^errors\.[A-Za-z0-9_.]{1,80}$/.test(key)) return key;
    const message = read(error, "message");
    return typeof message === "string" ? sanitizeText(message) : WITHHELD;
  }
  const sql = sqlMessageOf(error);
  if (sql) return sql;
  const issues = read(error, "issues");
  if (Array.isArray(issues)) return issuesMessageOf(issues);
  const message = read(error, "message");
  if (typeof message === "string")
    return message === "" ? "" : (failedQueryOf(message) ?? WITHHELD);
  return message === undefined ? "" : WITHHELD;
}

function sanitizeOne(
  error: unknown,
  options: { frames?: number },
  depth: number,
  seen: Set<object>,
): SanitizedError {
  if (!isError(error)) {
    return {
      name: "NonError",
      message: typeof error === "string" ? WITHHELD : `a thrown ${kindOf(error)}`,
      frames: [],
    };
  }
  seen.add(error);
  const rawName = read(error, "name");
  const name = typeof rawName === "string" && KNOWN_NAMES.has(rawName) ? rawName : "[name]";
  const message = messageOf(error);
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
  const ownCode = read(read(error, "data"), "code");
  const apiCode =
    read(error, LOUEZ_TEMPLATE) === true &&
    typeof ownCode === "string" &&
    /^[A-Z][A-Z0-9_]{1,63}$/.test(ownCode)
      ? ownCode
      : undefined;
  const statusCode = read(error, "statusCode");
  const errno = read(error, "errno");
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
    ...(apiCode === undefined ? {} : { apiCode }),
    ...(typeof statusCode === "number" && Number.isSafeInteger(statusCode) ? { statusCode } : {}),
    ...(typeof errno === "number" && Number.isSafeInteger(errno) ? { errno } : {}),
    frames,
    ...(causeFacts ? { cause: causeFacts } : {}),
  };
}

/**
 * `error` as a `SanitizedError`: never its own object, nor a property
 * outside the list, nor free text from outside Louez, and never a throw: a
 * field it cannot read is left out, and an error it cannot read at all is
 * `[unreadable error]`.
 */
export function sanitizeError(error: unknown, options: { frames?: number } = {}): SanitizedError {
  try {
    return sanitizeOne(error, options, 0, new Set());
  } catch {
    return { name: "Error", message: "[unreadable error]", frames: [] };
  }
}

/**
 * A provider's error as one line safe to log: its name, message (withheld
 * unless Louez's own) and codes (Stripe's `type`, `code`, `statusCode`).
 */
export function describeProviderError(error: unknown): string {
  const facts = sanitizeError(error, { frames: 0 });
  const codes = (["type", "code", "apiCode", "statusCode"] as const)
    .filter((key) => facts[key] !== undefined)
    .map((key) => `${key}=${String(facts[key])}`);
  return `${facts.name}: ${facts.message || "[no message]"}${codes.length > 0 ? ` (${codes.join(", ")})` : ""}`;
}

/** Logs a provider call that failed, as `describeProviderError` writes it. */
export function logProviderError(label: string, error: unknown): void {
  console.error(`${label}: ${describeProviderError(error)}`);
}
