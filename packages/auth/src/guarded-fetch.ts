import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";

/**
 * A GET of a URL someone else chose, that cannot reach inside Louez's
 * network. Every request goes through the CIMD transport: HTTPS only, every
 * DNS answer must be public, the connection is pinned to the checked
 * address, and redirects are never followed by it. This module adds what the
 * CIMD plugin adds around it: a timeout, a size cap read while streaming, and
 * redirects followed by hand, each hop checked again by the transport.
 *
 * The site icons of OAuth clients (oauth-client-icon.ts) and the images an
 * agent imports by URL (packages/api services/uploads.ts) use it.
 */

/** A guarded GET, the CIMD transport's signature. Injected in tests. */
export type GuardedFetch = ClientMetadataResourceFetch;

/** The transport every guarded request goes through, outside tests. */
export const guardedTransport: GuardedFetch = fetchClientMetadataResource;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface GuardedGetOptions {
  /** The `Accept` header. */
  accept: string;
  /** Largest body read; past it the read stops and the answer is `too_large`. */
  maxBytes: number;
  /** Time given to each request and to reading the body. */
  timeoutMs: number;
  /** Redirects followed at most. */
  maxRedirects: number;
  fetchResource?: GuardedFetch;
}

/** Why a guarded GET got no body. */
export type GuardedGetFailure =
  /** A URL or a redirect that is not plain HTTPS (credentials included). */
  | "not_https"
  /** The transport refused or failed: a private or missing address, a broken connection. */
  | "unreachable"
  | "timeout"
  /** An answer other than 200, or a redirect without a location. */
  | "status"
  | "too_many_redirects"
  | "too_large";

export type GuardedGetResult =
  | { ok: true; url: string; body: Uint8Array }
  | { ok: false; reason: GuardedGetFailure; status?: number };

const TIMED_OUT = Symbol("timed out");
const TOO_LARGE = Symbol("too large");

/**
 * `promise`, or `TIMED_OUT` once `ms` have passed. The transport's abort
 * signal does not cover its DNS lookup, so a deadline must not wait for it.
 */
export function withDeadline<T>(
  promise: T | Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
    // A hung lookup must not keep the process alive.
    timer.unref?.();
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

export const isTimedOut = (value: unknown): value is typeof TIMED_OUT => value === TIMED_OUT;

/** The body, or `TOO_LARGE` as soon as it passes `maxBytes`. */
async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | typeof TOO_LARGE> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return TOO_LARGE;
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        return TOO_LARGE;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const isPlainHttps = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

/**
 * GET `url` and read at most `maxBytes` of a 200 answer, following up to
 * `maxRedirects` redirects to HTTPS URLs only, each through the transport.
 */
export async function guardedGet(
  url: string,
  options: GuardedGetOptions,
): Promise<GuardedGetResult> {
  const fetchResource = options.fetchResource ?? guardedTransport;
  let current = url;
  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    if (!isPlainHttps(current)) return { ok: false, reason: "not_https" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    timeout.unref?.();
    try {
      const response = await withDeadline(
        fetchResource(current, {
          headers: { Accept: options.accept },
          redirect: "manual",
          signal: controller.signal,
        }),
        options.timeoutMs,
      );
      if (isTimedOut(response)) return { ok: false, reason: "timeout" };
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => {});
        const location = response.headers.get("location");
        if (!location) return { ok: false, reason: "status", status: response.status };
        current = new URL(location, current).href;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        return { ok: false, reason: "status", status: response.status };
      }
      const body = await withDeadline(readLimited(response, options.maxBytes), options.timeoutMs);
      if (isTimedOut(body) || body === TOO_LARGE) {
        controller.abort();
        return { ok: false, reason: isTimedOut(body) ? "timeout" : "too_large" };
      }
      return { ok: true, url: current, body };
    } catch {
      return { ok: false, reason: controller.signal.aborted ? "timeout" : "unreachable" };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, reason: "too_many_redirects" };
}
