/**
 * The request, and where the key may go: only to the base URL's origin,
 * never in a URL, never through a redirect.
 */
import { UsageError } from "./args.js";

export const DEFAULT_API_URL = "https://app.louez.io/api/v1";

/** Hosts an http:// base URL may name without --insecure: this machine and Localify's. */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".localify")
  );
}

/** The base URL, checked: https, or http on a local host or with --insecure. */
export function resolveBaseUrl(raw: string, insecure: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`The API URL "${raw}" is not a URL.`);
  }
  if (url.username || url.password) {
    throw new UsageError("The API URL may not hold a user name or a password.");
  }
  if (url.search || url.hash) {
    throw new UsageError("The API URL may not hold a query or a fragment.");
  }
  if (url.protocol === "http:") {
    if (!insecure && !isLocalHost(url.hostname)) {
      throw new UsageError(
        `The API URL ${url.origin} is not https: the key would travel in clear text. Use https, or pass --insecure.`,
      );
    }
  } else if (url.protocol !== "https:") {
    throw new UsageError(`The API URL must be https, not ${url.protocol}.`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

/**
 * The URL of `path` under the base URL. `path` is relative to it, so a value
 * that would leave its origin (`//host`, `https://…`) is refused.
 */
export function requestUrl(base: URL, path: string, query?: URLSearchParams): URL {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\s]/.test(path)) {
    throw new UsageError(`The path "${path}" must start with a single / and hold no space.`);
  }
  const url = new URL(base.href);
  const [pathname = "", search] = path.split("?", 2);
  url.pathname = `${base.pathname}${pathname}`;
  url.search = search ?? "";
  if (query) for (const [name, value] of query) url.searchParams.append(name, value);
  if (url.origin !== base.origin) throw new UsageError(`The path "${path}" leaves ${base.origin}.`);
  return url;
}

interface HeaderOptions {
  apiKey: string;
  userAgent: string;
  idempotencyKey?: string;
  confirmation?: string;
  hasBody: boolean;
}

export function buildHeaders(options: HeaderOptions): Headers {
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${options.apiKey}`,
    "User-Agent": options.userAgent,
  });
  if (options.hasBody) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  if (options.confirmation) headers.set("Louez-Confirmation", options.confirmation);
  return headers;
}

/** What the server answered. */
export interface Answer {
  status: number;
  headers: Headers;
  /** The body, parsed when it is JSON; its text otherwise; undefined when empty. */
  body: unknown;
}

export type SendResult = { ok: true; answer: Answer } | { ok: false; error: Error };

interface OutgoingRequest {
  method: string;
  url: URL;
  headers: Headers;
  body?: unknown;
  timeoutMs: number;
}

/**
 * Sends one request, and never follows a redirect: the next server would get
 * the key. A 3xx is answered as it came.
 */
export async function send(fetchImpl: typeof fetch, request: OutgoingRequest): Promise<SendResult> {
  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    text = await response.text();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
  let body: unknown;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { ok: true, answer: { status: response.status, headers: response.headers, body } };
}
