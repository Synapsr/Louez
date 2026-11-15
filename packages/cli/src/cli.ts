/**
 * The CLI: reads the command line, sends one request (two when --wait
 * carries out an approved write), writes the answer. Everything it touches
 * outside comes through `Io`, so the tests run it whole.
 */
import { readFileSync } from "node:fs";

import {
  buildInput,
  commandWords,
  globalLookup,
  lastValue,
  operationLookup,
  parseLine,
  stringFlag,
  type FlagValues,
} from "./args.js";
import { configFile, readConfig, removeConfig, writeConfig } from "./config.js";
import { groupHelp, mainHelp, operationHelp } from "./help.js";
import {
  DEFAULT_API_URL,
  buildHeaders,
  requestUrl,
  resolveBaseUrl,
  send,
  type Answer,
  type SendResult,
} from "./http.js";
import { number, record, text } from "./json.js";
import { METHODS, isHttpMethod, type Manifest, type Operation } from "./manifest.js";
import { manifest as generatedManifest } from "./manifest.generated.js";
import { API_KEY_SHAPE, Redactor, isApiKey } from "./secrets.js";
import { UsageError } from "./usage-error.js";

export const EXIT = { ok: 0, api: 1, usage: 2, person: 3, network: 4 } as const;

/**
 * How often an approval is read: `GET /handoffs/{id}` "every
 * `pollAfterSeconds` (30) seconds or more" (the reference's "Approvals").
 */
export const APPROVAL_POLL_SECONDS = 30;

const DEFAULT_TIMEOUT_SECONDS = 120;

const VERSION =
  text(
    record(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")))?.version,
  ) ?? "0.0.0";

interface Output {
  write(text: string): unknown;
  isTTY?: boolean;
}

export interface Io {
  /** The arguments after `louez`. */
  argv: readonly string[];
  env: Record<string, string | undefined>;
  stdout: Output;
  stderr: Output;
  stdinIsTTY: boolean;
  readStdin(): Promise<string>;
  /** Asks for a secret on the terminal without echoing it. */
  readSecret(prompt: string): Promise<string>;
  readFile(path: string): Promise<string>;
  fetch: typeof fetch;
  /** Waits `ms`; resolves early when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
  /** The signal that ends a request waiting `ms` for its answer. */
  timeoutSignal(ms: number): AbortSignal;
  /** Aborts on Ctrl-C while it is watched; `stop` hands Ctrl-C back. */
  watchInterrupt(): { signal: AbortSignal; stop(): void };
  configDir: string;
  newIdempotencyKey(): string;
  manifest?: Manifest;
}

/** An output of the session: text, and JSON redacted by value. */
interface SessionOutput extends Output {
  /** Writes `value` as one JSON document, every string in it redacted first. */
  writeJson(value: unknown): void;
}

/** The `Io` the commands use: its outputs never show a credential. */
type Session = Omit<Io, "stdout" | "stderr"> & {
  stdout: SessionOutput;
  stderr: SessionOutput;
  /** Adds a credential to the ones every output hides (a value that is no key is ignored). */
  secret(value: string): void;
};

/** The values `--api-key` was given on the command line. */
function apiKeyArguments(argv: readonly string[]): string[] {
  const keys: string[] = [];
  argv.forEach((token, index) => {
    if (token.startsWith("--api-key=")) keys.push(token.slice("--api-key=".length));
    const next = argv[index + 1];
    if (token === "--api-key" && next !== undefined) keys.push(next);
  });
  return keys;
}

/**
 * Runs the command. Everything it writes goes through one redaction
 * (`Redactor`, secrets.ts) of the API key in use, of `LOUEZ_API_KEY` and of
 * every value given to `--api-key`, when they are keys or start like one:
 * JSON is redacted value by value before it is written, so it stays valid;
 * other text, as text.
 */
export async function main(io: Io): Promise<number> {
  const redactor = new Redactor();
  for (const key of apiKeyArguments(io.argv)) redactor.add(key);
  redactor.add(io.env.LOUEZ_API_KEY);
  const hide = (output: Output): SessionOutput => ({
    write: (text: string) => output.write(redactor.text(text)),
    writeJson: (value: unknown) => {
      const redacted = redactor.value(value);
      output.write(
        `${output.isTTY ? JSON.stringify(redacted, null, 2) : JSON.stringify(redacted)}\n`,
      );
    },
    isTTY: output.isTTY,
  });
  const session: Session = {
    ...io,
    stdout: hide(io.stdout),
    stderr: hide(io.stderr),
    secret: (value) => redactor.add(value),
  };

  try {
    return await run(session);
  } catch (error) {
    if (error instanceof UsageError) {
      session.stderr.write(`louez: ${error.message}\nRun \`louez --help\` for usage.\n`);
      return EXIT.usage;
    }
    session.stderr.write(`louez: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.api;
  }
}

async function run(io: Session): Promise<number> {
  const manifest = io.manifest ?? generatedManifest;
  const argv = io.argv;
  const wordIndexes = commandWords(argv, 3);
  const words = wordIndexes.map((index) => argv[index] ?? "");
  const rest = (used: number) =>
    argv.filter((_, index) => !wordIndexes.slice(0, used).includes(index));
  const first = words[0];

  if (first === undefined || first === "help") {
    const line = parseLine(first === "help" ? rest(1) : argv, globalLookup);
    if (lastValue(line.values, "version") === true) {
      io.stdout.write(`louez ${VERSION} (API ${manifest.apiVersion})\n`);
      return EXIT.ok;
    }
    const asked = first === "help" || lastValue(line.values, "help") === true;
    (asked ? io.stdout : io.stderr).write(`${mainHelp(manifest, VERSION)}\n`);
    return asked ? EXIT.ok : EXIT.usage;
  }

  if (first === "auth") return auth(io, words[1], rest(2));
  if (first === "api") return api(io, words[1], words[2], rest(3));

  const group = manifest.groups.find((candidate) => candidate.name === first);
  let operation: Operation | undefined;
  let line;
  if (group) {
    const action = words[1];
    operation = manifest.operations.find(
      (candidate) => candidate.group === group.name && candidate.action === action,
    );
    if (!operation) {
      const asked = lastValue(parseLine(rest(1), globalLookup).values, "help") === true;
      if (action !== undefined && !asked) {
        throw new UsageError(
          `Unknown action "${action}" in ${group.name}. Run \`louez ${group.name} --help\`.`,
        );
      }
      (asked ? io.stdout : io.stderr).write(`${groupHelp(manifest, group)}\n`);
      return asked ? EXIT.ok : EXIT.usage;
    }
    line = parseLine(rest(2), operationLookup(operation));
  } else {
    operation = manifest.operations.find((candidate) => candidate.id === first);
    if (!operation) throw new UsageError(`Unknown command "${first}".`);
    line = parseLine(rest(1), operationLookup(operation));
  }

  if (lastValue(line.values, "help") === true) {
    io.stdout.write(`${operationHelp(operation)}\n`);
    return EXIT.ok;
  }

  const reader = sourceReader(io);
  const input = await buildInput(operation, line, reader);
  const target = await resolveTarget(io, line.values);
  return callAndReport(
    io,
    target,
    line.values,
    {
      method: operation.method,
      path: input.path,
      query: input.query,
      body: input.body,
      idempotent: operation.method !== "GET" && operation.idempotent,
    },
    reader.stdinText,
  );
}

/** Reads `--json`'s text: `-` is standard input, `@file` a file, anything else the JSON itself. */
function sourceReader(io: Session) {
  let stdin: Promise<string> | undefined;
  const reader = async (spec: string) => {
    if (spec === "-") return (stdin ??= io.readStdin());
    if (spec.startsWith("@")) {
      try {
        return await io.readFile(spec.slice(1));
      } catch (error) {
        throw new UsageError(
          `Cannot read ${spec.slice(1)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return spec;
  };
  return Object.assign(reader, { stdinText: () => stdin });
}

interface Target {
  base: URL;
  apiKey: string;
  /** Where the key came from, for `auth status`; never the key. */
  keySource: string;
  timeoutMs: number;
}

/** The key a command runs with, and where it came from (never the key itself). */
interface Credential {
  apiKey: string;
  keySource: string;
  /** Given for this invocation (`--api-key`, `LOUEZ_API_KEY`, the key `auth login` checks): not the saved key. */
  given: boolean;
}

function wellFormed(key: string, source: string): string {
  if (!isApiKey(key)) {
    throw new UsageError(
      key === ""
        ? `${source} is empty: give a Louez API key (${API_KEY_SHAPE}), or leave it out.`
        : `${source} is not a Louez API key (${API_KEY_SHAPE}).`,
    );
  }
  return key;
}

/**
 * The one place the key is chosen, in this order: the key `auth login`
 * checks; `--api-key` when present; `LOUEZ_API_KEY` when set; the saved key.
 * A source that is present must hold a well-formed key: an empty or
 * malformed one is a usage error, never a reason to read the next source.
 */
async function selectCredential(
  io: Session,
  values: FlagValues,
  loginKey: string | undefined,
): Promise<Credential & { saved?: { apiUrl?: string } }> {
  if (loginKey !== undefined) {
    return {
      apiKey: wellFormed(loginKey, "The key given to login"),
      keySource: "login",
      given: true,
    };
  }
  if (values.has("api-key")) {
    return {
      apiKey: wellFormed(stringFlag(values, "api-key") ?? "", "--api-key"),
      keySource: "--api-key",
      given: true,
    };
  }
  const envKey = io.env.LOUEZ_API_KEY;
  if (envKey !== undefined) {
    return { apiKey: wellFormed(envKey, "LOUEZ_API_KEY"), keySource: "LOUEZ_API_KEY", given: true };
  }
  const { config: saved, warnings } = await readConfig(io.configDir);
  for (const warning of warnings) io.stderr.write(`louez: ${warning}\n`);
  if (saved.apiKey === undefined) {
    throw new UsageError(
      "No API key: set LOUEZ_API_KEY, pass --api-key, or run `louez auth login`.",
    );
  }
  const file = configFile(io.configDir);
  return {
    apiKey: wellFormed(saved.apiKey, `The key saved in ${file}`),
    keySource: file,
    given: false,
    saved,
  };
}

/**
 * Where the call goes, and with which key.
 *
 * - A key given for this invocation goes with the URL given for it
 *   (`--api-url` when present, `LOUEZ_API_URL` when set; empty is refused)
 *   or the default one: the caller paired them.
 * - The saved key goes only to the origin it was saved for: with no URL
 *   given, the saved URL; a URL given on another origin is refused, naming
 *   both, before anything is sent. A file saved without a URL was saved for
 *   the default one.
 */
async function resolveTarget(io: Session, values: FlagValues, loginKey?: string): Promise<Target> {
  const insecure = lastValue(values, "insecure") === true;
  const givenUrl = values.has("api-url")
    ? (stringFlag(values, "api-url") ?? "")
    : io.env.LOUEZ_API_URL;
  if (givenUrl === "") {
    throw new UsageError(
      `${values.has("api-url") ? "--api-url" : "LOUEZ_API_URL"} is empty: give the API's base URL, or leave it out.`,
    );
  }
  const credential = await selectCredential(io, values, loginKey);
  io.secret(credential.apiKey);

  let base: URL;
  if (credential.given) {
    base = resolveBaseUrl(givenUrl ?? DEFAULT_API_URL, insecure);
  } else {
    const savedBase = resolveBaseUrl(credential.saved?.apiUrl ?? DEFAULT_API_URL, true);
    base = resolveBaseUrl(givenUrl ?? savedBase.href, insecure);
    if (base.origin !== savedBase.origin) {
      throw new UsageError(
        `The saved key belongs to ${savedBase.origin}; it is never sent to ${base.origin}. For ${base.origin}, give its key with LOUEZ_API_KEY or --api-key, or save it with \`louez auth login --api-url ${base.href}\`.`,
      );
    }
  }
  const timeout = stringFlag(values, "timeout");
  const seconds = timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(timeout);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new UsageError(`--timeout is a number of seconds, not "${timeout}".`);
  }
  return {
    base,
    apiKey: credential.apiKey,
    keySource: credential.keySource,
    timeoutMs: seconds * 1000,
  };
}

interface Call {
  method: string;
  path: string;
  query?: URLSearchParams;
  body?: unknown;
  /** A write that takes `Idempotency-Key`: one is generated when none is given. */
  idempotent: boolean;
  idempotencyKey?: string;
  confirmation?: string;
}

/** Sends `call`; `cancel` (Ctrl-C while waiting) ends it as its timeout would. */
function perform(
  io: Session,
  target: Target,
  call: Call,
  cancel?: AbortSignal,
): Promise<SendResult> {
  const url = requestUrl(target.base, call.path, call.query);
  const headers = buildHeaders({
    apiKey: target.apiKey,
    userAgent: `louez-cli/${VERSION}`,
    idempotencyKey: call.idempotencyKey,
    confirmation: call.confirmation,
    hasBody: call.body !== undefined,
  });
  return send(io.fetch, {
    method: call.method,
    url,
    headers,
    body: call.body,
    signal: cancel
      ? AbortSignal.any([io.timeoutSignal(target.timeoutMs), cancel])
      : io.timeoutSignal(target.timeoutMs),
  });
}

interface Approval {
  id: string;
  url: string;
  expiresAt?: string;
  pollAfterSeconds?: number;
}

/** What the CLI reads of an error's body (the reference's `Error` schema). */
interface ApiError {
  /** `data.code`, the code to branch on. */
  code?: string;
  /** The HTTP-level `code`, such as FORBIDDEN. */
  httpCode?: string;
  message?: string;
  retryable: boolean;
  confirmationToken?: string;
  approval?: Approval;
}

function errorOf(answer: Answer): ApiError {
  const error = record(answer.body);
  const data = record(error?.data);
  const details = record(data?.details);
  const approval = record(details?.approval);
  const id = text(approval?.id);
  const url = text(approval?.url);
  return {
    code: text(data?.code),
    httpCode: text(error?.code),
    message: text(error?.message),
    retryable: data?.retryable === true,
    confirmationToken: text(details?.confirmationToken),
    approval:
      id && url
        ? {
            id,
            url,
            expiresAt: text(approval?.expiresAt),
            pollAfterSeconds: number(approval?.pollAfterSeconds),
          }
        : undefined,
  };
}

/** Sends the call, waits for an approval when asked to, and writes the answer. */
async function callAndReport(
  io: Session,
  target: Target,
  values: FlagValues,
  call: Omit<Call, "idempotencyKey" | "confirmation">,
  stdinText?: () => Promise<string> | undefined,
): Promise<number> {
  const givenKey = stringFlag(values, "idempotency-key");
  const full: Call = {
    ...call,
    idempotencyKey: givenKey ?? (call.idempotent ? io.newIdempotencyKey() : undefined),
    confirmation: stringFlag(values, "confirmation"),
  };
  const result = await perform(io, target, full);
  if (!result.ok) return networkFailure(io, target, result.error, full, givenKey === undefined);
  let answer = result.answer;
  const rerun = await rerunHint(io.argv, stdinText?.());

  const { code, approval } = errorOf(answer);
  if (
    lastValue(values, "wait") === true &&
    approval &&
    (code === "APPROVAL_REQUIRED" || code === "APPROVAL_PENDING")
  ) {
    io.stderr.write(`louez: this write needs a person's approval. Open:\n  ${approval.url}\n`);
    const waited = await waitForApproval(io, target, approval, rerun);
    if (waited !== "approved") return waited;
    const again = await perform(io, target, { ...full, confirmation: approval.id });
    if (!again.ok) return networkFailure(io, target, again.error, full, givenKey === undefined);
    answer = again.answer;
  }
  return report(io, answer, rerun);
}

/** Builds the command to run again, with `--confirmation <id>`. */
type Rerun = (confirmation: string) => string;

async function rerunHint(
  argv: readonly string[],
  stdin: Promise<string> | undefined,
): Promise<Rerun> {
  const stdinText = stdin ? await stdin : undefined;
  return (confirmation) => rerunCommand(argv, confirmation, stdinText);
}

function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The same command line with `--confirmation <id>`: without `--wait`, the key
 * replaced by `"$LOUEZ_API_KEY"` (never printed), and a body read from
 * standard input written inline, as the input is gone.
 */
export function rerunCommand(
  argv: readonly string[],
  confirmation: string,
  stdinText?: string,
): string {
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    const [flag, inline] = token.startsWith("--") ? token.split(/=(.*)/s, 2) : [token, undefined];
    if (flag === "--confirmation") {
      if (inline === undefined) i++;
    } else if (flag === "--wait") {
      // dropped
    } else if (flag === "--api-key") {
      if (inline === undefined) i++;
      words.push('--api-key "$LOUEZ_API_KEY"');
    } else if (flag === "--json" && (inline ?? argv[i + 1]) === "-" && stdinText !== undefined) {
      if (inline === undefined) i++;
      words.push("--json", shellQuote(JSON.stringify(JSON.parse(stdinText))));
    } else {
      words.push(shellQuote(token));
    }
  }
  words.push("--confirmation", shellQuote(confirmation));
  return `louez ${words.join(" ")}`;
}

/**
 * Reads the approval every `pollAfterSeconds` (never under
 * APPROVAL_POLL_SECONDS) until it is decided or ends. "approved", or the
 * exit code to end with.
 */
async function waitForApproval(
  io: Session,
  target: Target,
  approval: Approval,
  rerun: Rerun,
): Promise<"approved" | number> {
  const seconds = Math.max(APPROVAL_POLL_SECONDS, approval.pollAfterSeconds ?? 0);
  const deadline = approval.expiresAt ? Date.parse(approval.expiresAt) : Number.NaN;
  io.stderr.write(
    `louez: waiting for the decision, checking every ${seconds} s${Number.isNaN(deadline) ? "" : ` until ${approval.expiresAt}`}. Ctrl-C stops waiting; the approval stays open.\n`,
  );
  // Ctrl-C ends the wait, never the approval, and nothing is carried out.
  const stopped = () => {
    io.stderr.write(
      `louez: stopped waiting. Nothing was done, and the approval stays open:\n  ${approval.url}\nOnce it is approved, run:\n  ${rerun(approval.id)}\n`,
    );
    return EXIT.person;
  };
  const interrupt = io.watchInterrupt();
  try {
    for (;;) {
      await io.sleep(seconds * 1000, interrupt.signal);
      if (interrupt.signal.aborted) return stopped();
      if (io.now() >= deadline) {
        io.stderr.write("louez: the approval expired undecided. Nothing was done.\n");
        return EXIT.api;
      }
      // Ctrl-C also ends a read in flight, not only a wait between reads.
      const read = await perform(
        io,
        target,
        { method: "GET", path: `/handoffs/${encodeURIComponent(approval.id)}`, idempotent: false },
        interrupt.signal,
      );
      if (interrupt.signal.aborted) return stopped();
      if (!read.ok) {
        io.stderr.write(
          `louez: could not read the approval: ${describeNetworkError(read.error, target)}\nOnce it is approved, run the command again with --confirmation ${approval.id}.\n`,
        );
        return EXIT.network;
      }
      const { status, body } = read.answer;
      if (status < 200 || status >= 300) {
        io.stderr.writeJson(body ?? null);
        io.stderr.write(
          `louez: could not read the approval (${status} ${errorOf(read.answer).code ?? ""}).\n`,
        );
        return EXIT.api;
      }
      const handoff = record(body);
      const handoffStatus = text(handoff?.status);
      const failure = record(handoff?.failure);
      switch (handoffStatus) {
        case "pending":
        case "opened":
          continue;
        case "approved":
          io.stderr.write("louez: approved. Carrying it out.\n");
          return "approved";
        case "completed":
          io.stderr.writeJson(body);
          io.stderr.write(
            "louez: an earlier request already carried this approval out. Nothing was done again: read the record before acting.\n",
          );
          return EXIT.api;
        case "failed": {
          io.stderr.writeJson(body);
          const reason = text(record(handoff?.decision)?.reason);
          io.stderr.write(
            text(failure?.code) === "declined"
              ? `louez: the person refused${reason ? `, saying ${JSON.stringify(reason)}` : ""}. Nothing was done.\n`
              : `louez: the approval ended (${text(failure?.code) ?? "failed"}): ${text(failure?.message) ?? ""} Nothing was done.\n`,
          );
          return EXIT.api;
        }
        default:
          io.stderr.writeJson(body);
          io.stderr.write(
            `louez: the approval is ${handoffStatus ?? "unknown"}. Nothing was done.\n`,
          );
          return EXIT.api;
      }
    }
  } finally {
    interrupt.stop();
  }
}

function describeNetworkError(error: Error, target: Target): string {
  if (error.name === "TimeoutError") {
    return `${target.base.origin} did not answer within ${target.timeoutMs / 1000} s.`;
  }
  const cause = record(error.cause);
  return `${target.base.origin} could not be reached (${text(cause?.code) ?? text(cause?.message) ?? error.message}).`;
}

function networkFailure(
  io: Session,
  target: Target,
  error: Error,
  call: Call,
  keyGenerated: boolean,
): number {
  io.stderr.write(`louez: ${describeNetworkError(error, target)}\n`);
  if (call.idempotencyKey) {
    io.stderr.write(
      keyGenerated
        ? `If the request reached Louez, it may have been carried out. Run the same command again with --idempotency-key ${call.idempotencyKey}: Louez then answers with the first call's outcome instead of running it twice.\n`
        : "If the request reached Louez, it may have been carried out. Run the same command again with the same --idempotency-key: Louez then answers with the first call's outcome instead of running it twice.\n",
    );
  }
  return EXIT.network;
}

/** Writes the answer: its JSON on stdout, or the error on stderr, and the exit code. */
function report(io: Session, answer: Answer, rerun: Rerun): number {
  const { status, headers, body } = answer;
  if (status >= 200 && status < 300) {
    if (body !== undefined) io.stdout.writeJson(body);
    if (headers.get("Louez-Replayed") === "true") {
      io.stderr.write(
        "louez: replayed: the stored result of an earlier call with this idempotency key.\n",
      );
    }
    return EXIT.ok;
  }
  if (status >= 300 && status < 400) {
    io.stderr.write(
      `louez: the API answered ${status}, a redirect${headers.get("Location") ? ` to ${headers.get("Location")}` : ""}. louez never follows one, which would send the key along: set --api-url to the API's own address.\n`,
    );
    return EXIT.api;
  }

  io.stderr.writeJson(body ?? null);
  const error = errorOf(answer);
  const { code, approval } = error;
  if (code === "APPROVAL_REQUIRED" && approval) {
    io.stderr.write(
      `louez: this write needs a person's approval. Nothing was done. Open:\n  ${approval.url}\nOnce it is approved, run:\n  ${rerun(approval.id)}\nOr run the same command with --wait to wait for the decision.\n`,
    );
    return EXIT.person;
  }
  if (code === "APPROVAL_PENDING" && approval) {
    io.stderr.write(
      `louez: the approval is not decided yet. Nothing was done. Open:\n  ${approval.url}\nOnce it is approved, run:\n  ${rerun(approval.id)}\n`,
    );
    return EXIT.person;
  }
  const token = error.confirmationToken;
  if (code === "CONFIRMATION_REQUIRED" && token) {
    io.stderr.write(
      `louez: this write waits for a confirmation. Nothing was done. Check data.details.preview, then run:\n  ${rerun(token)}\n`,
    );
    return EXIT.person;
  }
  const label = code ?? error.httpCode ?? "";
  io.stderr.write(
    `louez: ${status}${label ? ` ${label}` : ""}: ${error.message ?? "the API refused the request."}${error.retryable ? " (retryable)" : ""}\n`,
  );
  return EXIT.api;
}

/** `louez api <METHOD> <path>`: any operation, by method and path. */
async function api(
  io: Session,
  rawMethod: string | undefined,
  path: string | undefined,
  argv: readonly string[],
): Promise<number> {
  const line = parseLine(argv, globalLookup);
  const asked = lastValue(line.values, "help") === true;
  if (asked || rawMethod === undefined) {
    (asked ? io.stdout : io.stderr).write(
      `Usage:\n  louez api <METHOD> <path> [--json <body>] [flags]\n\nSends any operation of the API, by its method (${METHODS.join(", ")}) and its path under the base URL, query included: louez api GET '/reservations?status=pending'.\n`,
    );
    return asked ? EXIT.ok : EXIT.usage;
  }
  const method = rawMethod.toUpperCase();
  if (!isHttpMethod(method))
    throw new UsageError(`"${rawMethod}" is not one of ${METHODS.join(", ")}.`);
  if (path === undefined) throw new UsageError("Missing <path>, such as /reservations.");
  if (line.positionals.length > 0)
    throw new UsageError(`Unexpected argument "${line.positionals[0]}".`);

  const reader = sourceReader(io);
  const spec = stringFlag(line.values, "json");
  let body: unknown;
  if (spec !== undefined) {
    if (method === "GET") throw new UsageError("A GET takes no body: put its query in the path.");
    try {
      body = JSON.parse(await reader(spec));
    } catch (error) {
      if (error instanceof UsageError) throw error;
      throw new UsageError("--json is not valid JSON.");
    }
  }
  const target = await resolveTarget(io, line.values);
  // Checked before anything is sent: a path that would leave the base URL.
  requestUrl(target.base, path);
  return callAndReport(
    io,
    target,
    line.values,
    { method, path, body, idempotent: method !== "GET" },
    reader.stdinText,
  );
}

/** `louez auth login | status | logout`. */
async function auth(
  io: Session,
  action: string | undefined,
  argv: readonly string[],
): Promise<number> {
  const line = parseLine(argv, globalLookup);
  if (line.positionals.length > 0)
    throw new UsageError(`Unexpected argument "${line.positionals[0]}".`);
  const file = configFile(io.configDir);
  if (lastValue(line.values, "help") === true || action === undefined) {
    const text = `Usage:
  louez auth login    Save an API key, read from standard input or asked for, after checking it.
  louez auth status   Show the store the key belongs to, and where the key comes from.
  louez auth logout   Remove the saved key.

The key is saved in ${file}, readable by you alone (0600), with the API URL it was
checked against: it is sent to that URL's origin only. A key given with LOUEZ_API_KEY or
--api-key comes before it, and goes with LOUEZ_API_URL or --api-url, or the default URL.
`;
    const asked = lastValue(line.values, "help") === true;
    (asked ? io.stdout : io.stderr).write(text);
    return asked ? EXIT.ok : EXIT.usage;
  }

  switch (action) {
    case "login": {
      // --api-key when present, even empty (then refused); else standard input or the prompt.
      const key = line.values.has("api-key")
        ? (stringFlag(line.values, "api-key") ?? "")
        : (io.stdinIsTTY ? await io.readSecret("Louez API key: ") : await io.readStdin()).trim();
      io.secret(key);
      const target = await resolveTarget(io, line.values, key);
      const stores = await readStores(io, target);
      if (typeof stores === "number") {
        io.stderr.write("louez: the key was not saved.\n");
        return stores;
      }
      // The key is saved with the URL it was checked against: it goes there only.
      const warnings = await writeConfig(io.configDir, { apiKey: key, apiUrl: target.base.href });
      for (const warning of warnings) io.stderr.write(`louez: ${warning}\n`);
      io.stdout.writeJson({ saved: file, apiUrl: target.base.href, store: stores });
      return EXIT.ok;
    }
    case "status": {
      const target = await resolveTarget(io, line.values);
      const store = await readStores(io, target);
      if (typeof store === "number") return store;
      io.stdout.writeJson({ apiUrl: target.base.href, key: { source: target.keySource }, store });
      return EXIT.ok;
    }
    case "logout": {
      const removed = await removeConfig(io.configDir);
      io.stdout.writeJson({ removed, file });
      if (io.env.LOUEZ_API_KEY)
        io.stderr.write("louez: LOUEZ_API_KEY is still set, and still used.\n");
      return EXIT.ok;
    }
    default:
      throw new UsageError(`Unknown auth action "${action}": login, status or logout.`);
  }
}

/**
 * The key's store, from `GET /stores` (a key reaches one store), or the exit
 * code of a failed read, its error written.
 */
async function readStores(
  io: Session,
  target: Target,
): Promise<Record<string, unknown> | null | number> {
  const call: Call = { method: "GET", path: "/stores", idempotent: false };
  const result = await perform(io, target, call);
  if (!result.ok) return networkFailure(io, target, result.error, call, false);
  if (result.answer.status !== 200) return report(io, result.answer, () => "");
  const items = record(result.answer.body)?.items;
  const store = Array.isArray(items) ? record(items[0]) : undefined;
  return store ? { id: store.id, name: store.name, slug: store.slug, role: store.role } : null;
}
