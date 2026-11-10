import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { ZodIssueCode } from "zod";

import { LOUEZ_ERROR_CODES, LOUEZ_ERROR_I18N_KEYS } from "./error-registry";
import { SCHEMA_NAMES } from "./schema-names";

/**
 * Errors as facts safe to log or send to an error tracker: codes and code
 * locations, never text. No message is kept, Louez's own included (a
 * template may hold a product's or a customer's name): `message` is
 * `[message withheld]`. What an error says is read from vocabularies this
 * module or Louez's code holds, never from the error's own claims:
 *
 * - its class, among known error classes, else `[name]`;
 * - its `code` and `type` (HTTP and oRPC, MySQL, Node, undici, Stripe),
 *   else `[code]`; `statusCode` and `errno` as integers;
 * - for Louez's errors, `apiCode` and `i18nKey` when Louez's code writes
 *   them (`error-registry.ts`), else `[code]`;
 * - for a MySQL error, the schema object its message names at its known
 *   place, when it reads as one of Louez's names;
 * - for a validation error, its issues' Zod codes and paths, a key outside
 *   the API's static field names being `[key]`;
 * - its stack's locations in the repository (`packages/…/x.ts:12:3`),
 *   without function names, read after the message only.
 *
 * `sanitizeError` never throws and never returns the error object, nor a
 * property outside its list.
 */

const FRAMES_MAX = 10;
const CAUSE_DEPTH = 3;
const ISSUES_MAX = 20;
const WITHHELD = "[message withheld]";
const UNKNOWN_CODE = "[code]";

const words = (list: string) => list.split(/\s+/).filter(Boolean);

// --- Vocabularies ----------------------------------------------------------------

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
 * Codes an error may carry, each shaped as a code: capitals (`FORBIDDEN`,
 * `ER_DUP_ENTRY`, `ENOENT`), lower snake case with an underscore (Stripe's
 * `card_declined`), or a Stripe error class (`StripeCardError`). No plain
 * word: a value that happens to be one says nothing then.
 */
export const KNOWN_CODES: ReadonlySet<string> = new Set([
  // HTTP, as oRPC names it.
  ...words(`BAD_REQUEST UNAUTHORIZED FORBIDDEN NOT_FOUND METHOD_NOT_SUPPORTED NOT_ACCEPTABLE TIMEOUT
    CONFLICT PRECONDITION_FAILED PAYLOAD_TOO_LARGE UNSUPPORTED_MEDIA_TYPE UNPROCESSABLE_CONTENT
    TOO_MANY_REQUESTS CLIENT_CLOSED_REQUEST INTERNAL_SERVER_ERROR NOT_IMPLEMENTED BAD_GATEWAY
    SERVICE_UNAVAILABLE GATEWAY_TIMEOUT`),
  // MySQL and mysql2.
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
  // Node: errno names, ERR_ codes, undici's.
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
  // Stripe: error types and classes, then error codes.
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
    invalid_number invalid_source_usage livemode_mismatch lock_timeout parameter_invalid_empty
    parameter_invalid_integer parameter_invalid_string_blank parameter_invalid_string_empty
    parameter_missing parameter_unknown payment_intent_action_required
    payment_intent_authentication_failure payment_intent_incompatible_payment_method
    payment_intent_payment_attempt_failed payment_intent_unexpected_state payment_method_unactivated
    payment_method_unexpected_state platform_api_key_expired processing_error rate_limit
    resource_already_exists resource_missing secret_key_required setup_intent_authentication_failure
    setup_intent_unexpected_state testmode_charges_only tls_version_unsupported url_invalid
    generic_decline do_not_honor lost_card stolen_card pickup_card`),
]);

/** Codes that are numbers: MySQL's error numbers, which a driver may put in `code`. */
const KNOWN_NUMERIC_CODES: ReadonlySet<number> = new Set([
  1040, 1044, 1045, 1048, 1049, 1053, 1054, 1062, 1064, 1136, 1146, 1153, 1205, 1213, 1264, 1265,
  1292, 1364, 1366, 1406, 1451, 1452, 1644, 3819,
]);

/** Zod's issue codes, from Zod itself. */
const ZOD_ISSUE_CODES: ReadonlySet<string> = new Set(Object.values(ZodIssueCode));

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

/**
 * An error's code as a report may keep it: one from the known vocabularies,
 * a number only when it is a known MySQL error number; any other code is
 * `[code]`, and no code at all undefined.
 */
export function sanitizeCode(value: unknown): string | undefined {
  if (typeof value === "number") {
    return KNOWN_NUMERIC_CODES.has(value) ? String(value) : UNKNOWN_CODE;
  }
  if (typeof value !== "string" || value === "") return undefined;
  return KNOWN_CODES.has(value) ? value : UNKNOWN_CODE;
}

// --- Reading safely -------------------------------------------------------------

/** An own or inherited property, or undefined when reading it throws (a getter, a revoked proxy). */
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

function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function isArray(value: unknown): boolean {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * The items of a list the error holds, read by index up to `max`, never
 * through its own methods (`slice`, `map`), into a fresh array.
 */
function itemsOf(list: unknown, max: number): unknown[] {
  if (!isArray(list)) return [];
  const length = read(list, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length <= 0) return [];
  const items: unknown[] = [];
  for (let index = 0; index < Math.min(length, max); index += 1) {
    items.push(read(list, String(index)));
  }
  return items;
}

/** What was thrown, by `typeof` (and arrays), never by a tag the value sets itself. */
function kindOf(value: unknown): string {
  if (value === null) return "null";
  return isArray(value) ? "array" : typeof value;
}

// --- Stack -------------------------------------------------------------------

/** A V8 frame, strictly: `    at fn (file:line:col)` or `    at file:line:col`. */
const V8_FRAME =
  /^ {4}at (?:(?:async )?(?:new )?[^\s()][^()\n]{0,200} \(([^\n]{1,400}):(\d{1,7}):(\d{1,7})\)|([^\s(][^\n]{0,400}):(\d{1,7}):(\d{1,7}))$/;
/** A source file of the repository's apps and packages, from its root. */
const REPO_FILE = /^(?:apps|packages)\/[\w.@()[\]/-]{1,300}\.(?:[cm]?[jt]sx?)$/;

let repositoryRoot: string | undefined;

/** The repository's root on this machine: where `pnpm-workspace.yaml` is, above the process. */
function rootOfRepository(): string {
  if (repositoryRoot !== undefined) return repositoryRoot;
  // Without the workspace's file above it, the process's own folder.
  repositoryRoot = process.cwd();
  let directory = repositoryRoot;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) {
      repositoryRoot = directory;
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return repositoryRoot;
}

/** Whether a file exists, remembered for the most recent paths asked. */
const FILES_REMEMBERED = 500;
const existingFiles = new Map<string, boolean>();

function isFile(path: string): boolean {
  const known = existingFiles.get(path);
  if (known !== undefined) return known;
  let found = false;
  try {
    found = statSync(path, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    found = false;
  }
  if (existingFiles.size >= FILES_REMEMBERED) existingFiles.clear();
  existingFiles.set(path, found);
  return found;
}

/**
 * A frame's place in the repository (`packages/…/x.ts:12:3`), or null. Its
 * syntax says little, so its file must be one this machine holds: no
 * `node_modules` anywhere in its path, and a file that exists under the
 * repository's apps and packages. A message cannot create a file.
 */
function frameLocation(line: string): string | null {
  const match = V8_FRAME.exec(line);
  if (!match) return null;
  // Groups 1 to 3: a named frame's file, line and column; 4 to 6: a bare frame's.
  const file = match[1] ?? match[4] ?? "";
  const row = match[2] ?? match[5];
  const column = match[3] ?? match[6];
  const path = file.startsWith("file://") ? file.slice("file://".length) : file;
  if (/(?:^|[/\\])node_modules(?:[/\\]|$)/.test(path)) return null;
  if (!path.startsWith("/") && !/^[A-Za-z]:[/\\]/.test(path)) return null;
  const root = rootOfRepository();
  const absolute = resolve(path);
  if (!absolute.startsWith(`${root}${sep}`)) return null;
  const inRepository = relative(root, absolute).replaceAll("\\", "/");
  if (!REPO_FILE.test(inRepository) || !isFile(absolute)) return null;
  return `${inRepository}:${row}:${column}`;
}

/**
 * The stack's places in the repository. Read after the message the stack
 * starts with when that message is the error's own, else after its first
 * line; either way a frame is kept only when its file is the machine's
 * (`frameLocation`), so a message that imitates frames adds none.
 */
function framesOf(stack: string, message: string, max: number): string[] {
  const colon = stack.slice(0, 120).indexOf(": ");
  const prelude =
    message !== "" &&
    colon > 0 &&
    /^[\w$.]{1,100}$/.test(stack.slice(0, colon)) &&
    stack.slice(colon + 2, colon + 2 + message.length) === message
      ? colon + 2 + message.length
      : Math.max(stack.indexOf("\n"), 0);
  const frames: string[] = [];
  for (const line of stack.slice(prelude).split("\n", 200)) {
    const location = frameLocation(line.slice(0, 700));
    if (location) frames.push(location);
    if (frames.length >= max) break;
  }
  return frames;
}

// --- Structures -------------------------------------------------------------------

type SchemaObjectKind = "key" | "column" | "constraint" | "table";

/** A name as MySQL quotes it: up to its closing quote. */
const QUOTED = "([^'\\n]{1,130})";

/**
 * MySQL's messages, by code, each read whole and anchored: a name is taken
 * only where the message puts it, never from the value it quotes.
 */
const SQL_PARSERS: Readonly<Record<string, readonly [SchemaObjectKind, RegExp]>> = {
  ER_DUP_ENTRY: ["key", new RegExp(`^Duplicate entry '[\\s\\S]*' for key '${QUOTED}'$`)],
  ER_DATA_TOO_LONG: [
    "column",
    new RegExp(`^Data too long for column '${QUOTED}' at row \\d{1,10}$`),
  ],
  ER_BAD_NULL_ERROR: ["column", new RegExp(`^Column '${QUOTED}' cannot be null$`)],
  ER_NO_DEFAULT_FOR_FIELD: [
    "column",
    new RegExp(`^Field '${QUOTED}' doesn't have a default value$`),
  ],
  ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: [
    "column",
    new RegExp(
      `^Incorrect [a-z ]{1,40} value: '[\\s\\S]*' for column (?:\`[^\`\\n]{1,64}\`\\.){0,2}'${QUOTED}' at row \\d{1,10}$`,
    ),
  ],
  WARN_DATA_TRUNCATED: [
    "column",
    new RegExp(`^Data truncated for column '${QUOTED}' at row \\d{1,10}$`),
  ],
  ER_BAD_FIELD_ERROR: ["column", new RegExp(`^Unknown column '${QUOTED}' in '[a-z ]{1,40}'$`)],
  ER_NO_SUCH_TABLE: ["table", new RegExp(`^Table '${QUOTED}' doesn't exist$`)],
  ER_NO_REFERENCED_ROW_2: [
    "constraint",
    /^Cannot add or update a child row: a foreign key constraint fails \(`[^`\n]{1,64}`\.`[^`\n]{1,64}`, CONSTRAINT `([^`\n]{1,64})` FOREIGN KEY [^']{0,600}\)$/,
  ],
  ER_ROW_IS_REFERENCED_2: [
    "constraint",
    /^Cannot delete or update a parent row: a foreign key constraint fails \(`[^`\n]{1,64}`\.`[^`\n]{1,64}`, CONSTRAINT `([^`\n]{1,64})` FOREIGN KEY [^']{0,600}\)$/,
  ],
};

/**
 * The schema object a MySQL error's message names at its known place, for
 * its code: kept only when Louez's schema authored that name (`SCHEMA_NAMES`,
 * once a database's or a table's prefix is dropped), else `[schema object]`.
 */
function schemaObjectOf(error: object): { kind: SchemaObjectKind; name: string } | undefined {
  const code = read(error, "code");
  if (typeof code !== "string" || !Object.hasOwn(SQL_PARSERS, code)) return undefined;
  const parser = SQL_PARSERS[code];
  const sqlMessage = read(error, "sqlMessage");
  const message = read(error, "message");
  const text =
    typeof sqlMessage === "string" ? sqlMessage : typeof message === "string" ? message : "";
  if (!parser || text.length > 4_000) return undefined;
  const quoted = parser[1].exec(text)?.[1];
  if (quoted === undefined) return undefined;
  const [kind] = parser;
  const name = quoted.slice(quoted.lastIndexOf(".") + 1);
  return { kind, name: SCHEMA_NAMES[kind].has(name) ? name : "[schema object]" };
}

/** A validation error's issues (Zod's, also under oRPC's): each one's Zod code and path. */
function issuesOf(list: unknown): Array<{ code: string; path: string }> {
  return itemsOf(list, ISSUES_MAX).map((issue) => {
    const code = read(issue, "code");
    const parts = itemsOf(read(issue, "path"), 10).map((part) =>
      typeof part === "number" && Number.isSafeInteger(part)
        ? String(part)
        : typeof part === "string" && PATH_KEYS.has(part)
          ? part
          : "[key]",
    );
    return {
      code: typeof code === "string" && ZOD_ISSUE_CODES.has(code) ? code : UNKNOWN_CODE,
      path: parts.join("."),
    };
  });
}

// --- Errors -----------------------------------------------------------------------

/** An error as it may be logged or reported: codes and code locations, no text. */
export interface SanitizedError {
  /** The error's class when it is a known one, else `[name]`. */
  name: string;
  /** Always withheld (`[message withheld]`), or empty when the error has none. */
  message: string;
  /** Codes from known vocabularies (`code`, Stripe's `type`), else `[code]`. */
  code?: string;
  type?: string;
  /** A Louez error's code (`data.code`) and translation key, when Louez's code writes them. */
  apiCode?: string;
  i18nKey?: string;
  statusCode?: number;
  errno?: number;
  /** For a MySQL error: the schema object its message names. */
  schemaObject?: { kind: SchemaObjectKind; name: string };
  /** For a validation error: its issues' Zod codes and paths. */
  issues?: Array<{ code: string; path: string }>;
  /** The stack's places in the repository: `packages/api/src/services/inbox.ts:1723:9`. */
  frames: string[];
  cause?: SanitizedError;
}

function sanitizeOne(
  error: unknown,
  options: { frames?: number },
  depth: number,
  seen: Set<object>,
): SanitizedError {
  if (!isError(error)) {
    return { name: "NonError", message: `a thrown ${kindOf(error)}`, frames: [] };
  }
  seen.add(error);
  const rawName = read(error, "name");
  const rawMessage = read(error, "message");
  const message = typeof rawMessage === "string" ? rawMessage : "";
  const stack = read(error, "stack");
  const frames =
    typeof stack === "string" && typeof rawMessage === "string"
      ? framesOf(stack, message, options.frames ?? FRAMES_MAX)
      : [];
  const code = sanitizeCode(read(error, "code"));
  const type = sanitizeCode(read(error, "type"));
  const data = read(error, "data");
  const dataCode = read(data, "code");
  const dataKey = read(data, "i18nKey");
  const serviceKey = read(error, "key");
  const apiCode =
    dataCode === undefined
      ? undefined
      : typeof dataCode === "string" && LOUEZ_ERROR_CODES.has(dataCode)
        ? dataCode
        : UNKNOWN_CODE;
  const key = dataKey ?? serviceKey;
  const i18nKey =
    key === undefined
      ? undefined
      : typeof key === "string" && LOUEZ_ERROR_I18N_KEYS.has(key)
        ? key
        : UNKNOWN_CODE;
  const statusCode = read(error, "statusCode");
  const errno = read(error, "errno");
  const schemaObject = schemaObjectOf(error);
  const rawIssues = read(error, "issues");
  const issues = isArray(rawIssues) ? issuesOf(rawIssues) : undefined;
  const cause = read(error, "cause");
  let causeFacts: SanitizedError | undefined;
  if (cause !== undefined && cause !== null && depth < CAUSE_DEPTH) {
    causeFacts =
      typeof cause === "object" && seen.has(cause)
        ? { name: "Error", message: "[cause cycle]", frames: [] }
        : sanitizeOne(cause, options, depth + 1, seen);
  }
  return {
    name: typeof rawName === "string" && KNOWN_NAMES.has(rawName) ? rawName : "[name]",
    message: rawMessage === undefined || rawMessage === "" ? "" : WITHHELD,
    ...(code === undefined ? {} : { code }),
    ...(type === undefined ? {} : { type }),
    ...(apiCode === undefined ? {} : { apiCode }),
    ...(i18nKey === undefined ? {} : { i18nKey }),
    ...(typeof statusCode === "number" && Number.isSafeInteger(statusCode) ? { statusCode } : {}),
    ...(typeof errno === "number" && Number.isSafeInteger(errno) ? { errno } : {}),
    ...(schemaObject ? { schemaObject } : {}),
    ...(issues ? { issues } : {}),
    frames,
    ...(causeFacts ? { cause: causeFacts } : {}),
  };
}

/**
 * `error` as a `SanitizedError`: never its own object, nor a property
 * outside the list, nor any text, and never a throw: a field it cannot read
 * is left out, and an error it cannot read at all is `[unreadable error]`.
 */
export function sanitizeError(error: unknown, options: { frames?: number } = {}): SanitizedError {
  try {
    return sanitizeOne(error, options, 0, new Set());
  } catch {
    return { name: "Error", message: "[unreadable error]", frames: [] };
  }
}

/** A provider's error as one line safe to log: its class and codes, no message. */
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
