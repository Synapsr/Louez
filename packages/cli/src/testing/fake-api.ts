/** A fake Louez API on 127.0.0.1, and an `Io` that records what the CLI writes. */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Io } from "../cli.js";

interface Received {
  method: string;
  /** The path and query, as sent. */
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export type Handler = (request: Received, response: ServerResponse) => void;

export interface FakeApi {
  /** The base URL, `http://127.0.0.1:<port>/api/v1`. */
  url: string;
  origin: string;
  received: Received[];
  close(): Promise<void>;
}

export async function startFakeApi(handler: Handler): Promise<FakeApi> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      received.push(entry);
      handler(entry, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    url: `${origin}/api/v1`,
    origin,
    received,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

/** An API error in the shape the API answers it. */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  retryable = false,
) {
  return {
    defined: true,
    code: status === 412 ? "PRECONDITION_FAILED" : "BAD_REQUEST",
    status,
    message,
    data: { code, retryable, ...(details ? { details } : {}) },
  };
}

const tempDirs: string[] = [];

/** A new empty directory, removed by `removeTempDirs`. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "louez-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

export async function removeTempDirs(): Promise<void> {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export interface TestIo extends Io {
  out(): string;
  err(): string;
  /** Every wait the CLI asked for, in ms. */
  sleeps: number[];
}

export async function testIo(
  argv: string[],
  options: {
    env?: Record<string, string>;
    stdin?: string;
    files?: Record<string, string>;
    configDir?: string;
    secret?: string;
    tty?: boolean;
    fetch?: typeof fetch;
    /** Called on each sleep; advances the clock by the time asked. */
    onSleep?: (ms: number) => void;
    startAt?: number;
  } = {},
): Promise<TestIo> {
  let stdout = "";
  let stderr = "";
  let clock = options.startAt ?? Date.parse("2026-11-15T10:00:00Z");
  const sleeps: number[] = [];
  return {
    argv,
    env: options.env ?? {},
    stdout: { write: (text: string) => (stdout += text), isTTY: options.tty ?? false },
    stderr: { write: (text: string) => (stderr += text), isTTY: false },
    stdinIsTTY: options.secret !== undefined,
    readStdin: async () => options.stdin ?? "",
    readSecret: async () => options.secret ?? "",
    readFile: async (path) => {
      const text = options.files?.[path];
      if (text === undefined) throw new Error("ENOENT: no such file");
      return text;
    },
    fetch: options.fetch ?? globalThis.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
      options.onSleep?.(ms);
    },
    now: () => clock,
    configDir: options.configDir ?? (await tempDir()),
    newIdempotencyKey: () => "generated-key-1",
    out: () => stdout,
    err: () => stderr,
    sleeps,
  };
}
