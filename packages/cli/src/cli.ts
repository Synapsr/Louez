/**
 * The CLI: reads the command line, sends one request (two when --wait
 * carries out an approved write), writes the answer. Everything it touches
 * outside comes through `Io`, so the tests run it whole.
 */
import { readFileSync } from "node:fs";

import {
  UsageError,
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
import type { HttpMethod, Manifest, Operation } from "./manifest.js";
import { manifest as generatedManifest } from "./manifest.generated.js";

export const EXIT = { ok: 0, api: 1, usage: 2, person: 3, network: 4 } as const;

/**
 * How often an approval is read: `GET /handoffs/{id}` "every
 * `pollAfterSeconds` (30) seconds or more" (the reference's "Approvals").
 */
export const APPROVAL_POLL_SECONDS = 30;

const DEFAULT_TIMEOUT_SECONDS = 120;

const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

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
  sleep(ms: number): Promise<void>;
  now(): number;
  configDir: string;
  newIdempotencyKey(): string;
  manifest?: Manifest;
}

export async function main(io: Io): Promise<number> {
  try {
    return await run(io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`louez: ${error.message}\nRun \`louez --help\` for usage.\n`);
      return EXIT.usage;
    }
    io.stderr.write(`louez: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.api;
  }
}

function json(value: unknown, output: Output): string {
  return `${output.isTTY ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`;
}

async function run(io: Io): Promise<number> {
  const manifest = io.manifest ?? generatedManifest;
  const argv = io.argv;
  const wordIndexes = commandWords(argv, 3);
  const words = wordIndexes.map((index) => argv[index]!);
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
function sourceReader(io: Io) {
  let stdin: Promise<string> | undefined;
  const reader = async (spec: string) => {
    if (spec === "-") return (stdin ??= io.readStdin());
    if (spec.startsWith("@")) {
      try {
        return await io.readFile(spec.slice(1));
      } catch (error) {
        throw new UsageError(`Cannot read ${spec.slice(1)}: ${(error as Error).message}`);
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

async function resolveTarget(io: Io, values: FlagValues, apiKeyOverride?: string): Promise<Target> {
  const saved = await readConfig(io.configDir);
  const flagKey = stringFlag(values, "api-key");
  const [apiKey, keySource] = apiKeyOverride
    ? [apiKeyOverride, "login"]
    : flagKey
      ? [flagKey, "--api-key"]
      : io.env.LOUEZ_API_KEY
        ? [io.env.LOUEZ_API_KEY, "LOUEZ_API_KEY"]
        : [saved.apiKey, configFile(io.configDir)];
  if (!apiKey) {
    throw new UsageError(
      "No API key: set LOUEZ_API_KEY, pass --api-key, or run `louez auth login`.",
    );
  }
  if (!/^[\x21-\x7e]+$/.test(apiKey)) {
    throw new UsageError(
      `The API key from ${keySource} holds a space or a character a key never has.`,
    );
  }
  const base = resolveBaseUrl(
    stringFlag(values, "api-url") ?? io.env.LOUEZ_API_URL ?? saved.apiUrl ?? DEFAULT_API_URL,
    lastValue(values, "insecure") === true,
  );
  const timeout = stringFlag(values, "timeout");
  const seconds = timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(timeout);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new UsageError(`--timeout is a number of seconds, not "${timeout}".`);
  }
  return { base, apiKey, keySource, timeoutMs: seconds * 1000 };
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

function perform(io: Io, target: Target, call: Call): Promise<SendResult> {
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
    timeoutMs: target.timeoutMs,
  });
}

interface ApiError {
  code?: string;
  message?: string;
  data?: {
    code?: string;
    retryable?: boolean;
    details?: {
      confirmationToken?: string;
      approval?: Approval;
    };
  };
}

interface Approval {
  id: string;
  url: string;
  expiresAt?: string;
  pollAfterSeconds?: number;
}

function errorBody(answer: Answer): ApiError {
  return typeof answer.body === "object" && answer.body !== null ? (answer.body as ApiError) : {};
}

function approvalOf(answer: Answer): Approval | undefined {
  const approval = errorBody(answer).data?.details?.approval;
  return approval && typeof approval.id === "string" && typeof approval.url === "string"
    ? approval
    : undefined;
}

/** Sends the call, waits for an approval when asked to, and writes the answer. */
async function callAndReport(
  io: Io,
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

  const code = errorBody(answer).data?.code;
  const approval = approvalOf(answer);
  if (
    lastValue(values, "wait") === true &&
    approval &&
    (code === "APPROVAL_REQUIRED" || code === "APPROVAL_PENDING")
  ) {
    io.stderr.write(`louez: this write needs a person's approval. Open:\n  ${approval.url}\n`);
    const waited = await waitForApproval(io, target, approval);
    if (waited !== "approved") return waited;
    const again = await perform(io, target, { ...full, confirmation: approval.id });
    if (!again.ok) return networkFailure(io, target, again.error, full, givenKey === undefined);
    answer = again.answer;
  }
  return report(io, answer, await rerunHint(io.argv, stdinText?.()));
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
    const token = argv[i]!;
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
  io: Io,
  target: Target,
  approval: Approval,
): Promise<"approved" | number> {
  const seconds = Math.max(APPROVAL_POLL_SECONDS, approval.pollAfterSeconds ?? 0);
  const deadline = approval.expiresAt ? Date.parse(approval.expiresAt) : Number.NaN;
  io.stderr.write(
    `louez: waiting for the decision, checking every ${seconds} s${Number.isNaN(deadline) ? "" : ` until ${approval.expiresAt}`}. Ctrl-C stops waiting; the approval stays open.\n`,
  );
  for (;;) {
    await io.sleep(seconds * 1000);
    if (io.now() >= deadline) {
      io.stderr.write("louez: the approval expired undecided. Nothing was done.\n");
      return EXIT.api;
    }
    const read = await perform(io, target, {
      method: "GET",
      path: `/handoffs/${encodeURIComponent(approval.id)}`,
      idempotent: false,
    });
    if (!read.ok) {
      io.stderr.write(
        `louez: could not read the approval: ${describeNetworkError(read.error, target)}\nOnce it is approved, run the command again with --confirmation ${approval.id}.\n`,
      );
      return EXIT.network;
    }
    const { status, body } = read.answer;
    if (status < 200 || status >= 300) {
      io.stderr.write(json(body ?? null, io.stderr));
      io.stderr.write(
        `louez: could not read the approval (${status} ${errorBody(read.answer).data?.code ?? ""}).\n`,
      );
      return EXIT.api;
    }
    const handoff = (body ?? {}) as {
      status?: string;
      failure?: { code?: string; message?: string } | null;
      decision?: { reason?: string | null } | null;
    };
    switch (handoff.status) {
      case "pending":
      case "opened":
        continue;
      case "approved":
        io.stderr.write("louez: approved. Carrying it out.\n");
        return "approved";
      case "completed":
        io.stderr.write(json(body, io.stderr));
        io.stderr.write(
          "louez: an earlier request already carried this approval out. Nothing was done again: read the record before acting.\n",
        );
        return EXIT.api;
      case "failed": {
        io.stderr.write(json(body, io.stderr));
        const reason = handoff.decision?.reason;
        io.stderr.write(
          handoff.failure?.code === "declined"
            ? `louez: the person refused${reason ? `, saying ${JSON.stringify(reason)}` : ""}. Nothing was done.\n`
            : `louez: the approval ended (${handoff.failure?.code ?? "failed"}): ${handoff.failure?.message ?? ""} Nothing was done.\n`,
        );
        return EXIT.api;
      }
      default:
        io.stderr.write(json(body, io.stderr));
        io.stderr.write(
          `louez: the approval is ${handoff.status ?? "unknown"}. Nothing was done.\n`,
        );
        return EXIT.api;
    }
  }
}

function describeNetworkError(error: Error, target: Target): string {
  if (error.name === "TimeoutError") {
    return `${target.base.origin} did not answer within ${target.timeoutMs / 1000} s.`;
  }
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  return `${target.base.origin} could not be reached (${cause?.code ?? cause?.message ?? error.message}).`;
}

function networkFailure(
  io: Io,
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
function report(io: Io, answer: Answer, rerun: Rerun): number {
  const { status, headers, body } = answer;
  if (status >= 200 && status < 300) {
    if (body !== undefined) io.stdout.write(json(body, io.stdout));
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

  io.stderr.write(json(body ?? null, io.stderr));
  const error = errorBody(answer);
  const code = error.data?.code;
  const approval = approvalOf(answer);
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
  const token = error.data?.details?.confirmationToken;
  if (code === "CONFIRMATION_REQUIRED" && token) {
    io.stderr.write(
      `louez: this write waits for a confirmation. Nothing was done. Check data.details.preview, then run:\n  ${rerun(token)}\n`,
    );
    return EXIT.person;
  }
  const label = code ?? error.code ?? "";
  io.stderr.write(
    `louez: ${status}${label ? ` ${label}` : ""}: ${error.message ?? "the API refused the request."}${error.data?.retryable ? " (retryable)" : ""}\n`,
  );
  return EXIT.api;
}

const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** `louez api <METHOD> <path>`: any operation, by method and path. */
async function api(
  io: Io,
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
  const method = rawMethod.toUpperCase() as HttpMethod;
  if (!METHODS.includes(method))
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
async function auth(io: Io, action: string | undefined, argv: readonly string[]): Promise<number> {
  const line = parseLine(argv, globalLookup);
  if (line.positionals.length > 0)
    throw new UsageError(`Unexpected argument "${line.positionals[0]}".`);
  const file = configFile(io.configDir);
  if (lastValue(line.values, "help") === true || action === undefined) {
    const text = `Usage:
  louez auth login    Save an API key, read from standard input or asked for, after checking it.
  louez auth status   Show the store the key belongs to, and where the key comes from.
  louez auth logout   Remove the saved key.

The key is saved in ${file}, readable by you alone (0600). LOUEZ_API_KEY and --api-key come before it.
`;
    const asked = lastValue(line.values, "help") === true;
    (asked ? io.stdout : io.stderr).write(text);
    return asked ? EXIT.ok : EXIT.usage;
  }

  switch (action) {
    case "login": {
      let key = stringFlag(line.values, "api-key");
      if (!key) {
        key = (
          io.stdinIsTTY ? await io.readSecret("Louez API key: ") : await io.readStdin()
        ).trim();
      }
      if (!key.startsWith("lz_")) throw new UsageError("A Louez API key starts with lz_.");
      const target = await resolveTarget(io, line.values, key);
      const stores = await readStores(io, target);
      if (typeof stores === "number") {
        io.stderr.write("louez: the key was not saved.\n");
        return stores;
      }
      const saved = await readConfig(io.configDir);
      const apiUrl = stringFlag(line.values, "api-url") ?? io.env.LOUEZ_API_URL;
      await writeConfig(io.configDir, { ...saved, apiKey: key, ...(apiUrl ? { apiUrl } : {}) });
      io.stdout.write(json({ saved: file, apiUrl: target.base.href, store: stores }, io.stdout));
      return EXIT.ok;
    }
    case "status": {
      const target = await resolveTarget(io, line.values);
      const store = await readStores(io, target);
      if (typeof store === "number") return store;
      io.stdout.write(
        json({ apiUrl: target.base.href, key: { source: target.keySource }, store }, io.stdout),
      );
      return EXIT.ok;
    }
    case "logout": {
      const removed = await removeConfig(io.configDir);
      io.stdout.write(json({ removed, file }, io.stdout));
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
  io: Io,
  target: Target,
): Promise<Record<string, unknown> | null | number> {
  const call: Call = { method: "GET", path: "/stores", idempotent: false };
  const result = await perform(io, target, call);
  if (!result.ok) return networkFailure(io, target, result.error, call, false);
  if (result.answer.status !== 200) return report(io, result.answer, () => "");
  const items = (result.answer.body as { items?: Array<Record<string, unknown>> } | undefined)
    ?.items;
  const store = items?.[0];
  return store ? { id: store.id, name: store.name, slug: store.slug, role: store.role } : null;
}
