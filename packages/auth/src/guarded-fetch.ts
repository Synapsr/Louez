import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import type { LookupAddress } from "node:dns";
import { Resolver } from "node:dns/promises";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

/**
 * A GET of a URL someone else chose, that cannot reach inside Louez's
 * network. Every request goes through the CIMD transport (`guardedTransport`):
 * HTTPS only, every DNS answer must be public, the connection is pinned to
 * the checked address, and redirects are never followed by it. This module
 * adds what the CIMD plugin adds around it: a timeout, a size cap read while
 * streaming, and redirects followed by hand, each hop checked again by the
 * transport.
 *
 * The CIMD plugin's metadata documents (oauth.ts), the site icons of OAuth
 * clients (oauth-client-icon.ts) and the images an agent imports by URL
 * (packages/api services/uploads.ts) use it.
 */

/** A guarded GET, the CIMD transport's signature. Injected in tests. */
export type GuardedFetch = ClientMetadataResourceFetch;

/**
 * The largest response head the transport reads: Cursor's metadata document
 * already comes with ~13.6 KB of headers, against Node's 16 KiB default.
 */
export const MAX_RESPONSE_HEADER_BYTES = 64 * 1024;

/** The longest a hostname's DNS resolution may take, whatever the caller's deadline. */
export const DNS_TIMEOUT_MS = 5_000;

const BODY_FORBIDDEN_STATUSES = new Set([204, 205, 304]);

/** Where a hostname resolves. It stops, and rejects, once `signal` aborts. */
export type ResolveHost = (hostname: string, signal: AbortSignal) => Promise<LookupAddress[]>;

/**
 * Resolves a hostname with its own resolver (c-ares, as `dns.resolve4` and
 * `dns.resolve6`), not `dns.lookup`: a lookup runs on libuv's thread pool,
 * which a slow name server would fill (4 threads by default), and no signal
 * stops it. These queries are cancelled when `signal` aborts or after
 * `timeoutMs`, so no DNS work outlives the fetch. IPv4 answers come first, as
 * the first answer is the one connected to. `servers` is for tests.
 */
export function createDnsResolve(
  options: { timeoutMs?: number; servers?: string[] } = {},
): ResolveHost {
  const timeoutMs = options.timeoutMs ?? DNS_TIMEOUT_MS;
  return async (hostname, signal) => {
    const family = isIP(hostname);
    if (family !== 0) return [{ address: hostname, family }];
    signal.throwIfAborted();
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
    if (options.servers) resolver.setServers(options.servers);
    const cancel = () => resolver.cancel();
    const deadline = setTimeout(cancel, timeoutMs);
    deadline.unref?.();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const [v4, v6] = await Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname),
      ]);
      signal.throwIfAborted();
      const addresses: LookupAddress[] = [
        ...(v4.status === "fulfilled" ? v4.value.map((address) => ({ address, family: 4 })) : []),
        ...(v6.status === "fulfilled" ? v6.value.map((address) => ({ address, family: 6 })) : []),
      ];
      if (addresses.length === 0 && v4.status === "rejected") throw v4.reason;
      return addresses;
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
    }
  };
}

/** What the transport may be given in tests: a local server, on plain HTTP. */
export interface PinnedTransportOptions {
  maxHeaderSize?: number;
  resolve?: ResolveHost;
  isAllowedAddress?: (address: string) => boolean;
  send?: (
    options: RequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ) => ClientRequest;
}

function responseHeaders(headers: IncomingMessage["headers"]): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) for (const item of value) result.append(name, item);
    else if (value !== undefined) result.append(name, value);
  }
  return result;
}

/**
 * The CIMD plugin's Node transport (`@better-auth/cimd/node`
 * `fetchClientMetadataResource`, 1.7.18), with `maxHeaderSize` set per
 * request: that one takes no such option, and raising Node's limit for the
 * process would raise it for the requests the app serves too. Every DNS
 * answer must be public; the first is pinned for the connection, while the
 * hostname stays the Host, the TLS server name and the certificate's
 * identity. A redirect is returned, never followed. The signal covers the
 * DNS resolution too.
 */
export function createPinnedTransport(options: PinnedTransportOptions = {}): GuardedFetch {
  const maxHeaderSize = options.maxHeaderSize ?? MAX_RESPONSE_HEADER_BYTES;
  const resolve = options.resolve ?? createDnsResolve();
  const isAllowedAddress = options.isAllowedAddress ?? isPublicRoutableHost;
  const send = options.send ?? httpsRequest;

  return async (input, init) => {
    const webRequest = new Request(input, init);
    const url = new URL(webRequest.url);
    if (url.protocol !== "https:") throw new TypeError("The transport requires an HTTPS URL");
    if (webRequest.method !== "GET" && webRequest.method !== "HEAD") {
      throw new TypeError("The transport supports only GET and HEAD");
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const signal = init?.signal ?? webRequest.signal;
    const addresses = await resolve(hostname, signal);
    if (addresses.length === 0) throw new TypeError("The hostname returned no DNS addresses");
    if (!addresses.every(({ address }) => isAllowedAddress(address))) {
      throw new TypeError("The hostname must resolve only to public-routable addresses");
    }
    const [pinned] = addresses;
    const headers = Object.fromEntries(webRequest.headers.entries());
    headers.host = url.host;

    return new Promise<Response>((resolveResponse, reject) => {
      const request = send(
        {
          hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: webRequest.method,
          headers,
          agent: false,
          servername: isIP(hostname) === 0 ? hostname : undefined,
          signal,
          maxHeaderSize,
          // Node may ask for every address (`all`) or one: either way, only
          // the one checked above.
          lookup: (_hostname, lookupOptions, callback) => {
            if (lookupOptions.all) callback(null, [pinned]);
            else callback(null, pinned.address, pinned.family);
          },
        },
        (response) => {
          const status = response.statusCode ?? 500;
          const body =
            webRequest.method === "HEAD" || BODY_FORBIDDEN_STATUSES.has(status)
              ? null
              : (Readable.toWeb(response) as ReadableStream<Uint8Array>);
          try {
            resolveResponse(
              new Response(body, {
                headers: responseHeaders(response.headers),
                status,
                statusText: response.statusMessage,
              }),
            );
          } catch (error) {
            response.destroy();
            reject(error);
          }
        },
      );
      request.once("error", reject);
      request.end();
    });
  };
}

/** The transport every guarded request goes through, outside tests. */
export const guardedTransport: GuardedFetch = createPinnedTransport();

const JSON_CONTENT_TYPE = /^application\/(?:[-\w.]+\+)?json\s*(?:;|$)/i;

/**
 * `transport` for a caller that may refuse an answer without reading or
 * cancelling its body, which would keep its connection open: the CIMD plugin
 * does on a redirect, a status other than 200 or a type other than JSON
 * (1.7.18). Each answer is read here before it is handed on: nothing of an
 * answer other than a JSON 200, at most `maxBytes` + 1 bytes of that one (the
 * caller sees it is too large), so the connection is closed by then. A body
 * still coming when the caller's signal aborts is cancelled.
 */
export function bufferedTransport(transport: GuardedFetch, maxBytes: number): GuardedFetch {
  return async (input, init) => {
    const response = await transport(input, init);
    const { status, statusText } = response;
    const headers = new Headers(response.headers);
    const reader = response.body?.getReader();
    if (!reader) return new Response(null, { status, statusText, headers });
    if (status !== 200 || !JSON_CONTENT_TYPE.test(headers.get("content-type") ?? "")) {
      await reader.cancel().catch(() => {});
      return new Response(null, { status, statusText, headers });
    }
    const signal = init?.signal;
    const onAbort = () => void reader.cancel().catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (length <= maxBytes) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        chunks.push(value);
        length += value.byteLength;
      }
      if (length > maxBytes) await reader.cancel().catch(() => {});
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      reader.releaseLock();
    }
    const body = new Uint8Array(Math.min(length, maxBytes + 1));
    let offset = 0;
    for (const chunk of chunks) {
      const part = chunk.subarray(0, body.byteLength - offset);
      body.set(part, offset);
      offset += part.byteLength;
      if (offset === body.byteLength) break;
    }
    return new Response(body, { status, statusText, headers });
  };
}

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
  /**
   * Called with each piece of work the GET starts that may outlive its
   * deadline: a transport call, which the GET aborts at its deadline but may
   * take a moment to settle, and a body read. A caller that bounds how many
   * GETs run at once holds its place until all of them have settled, not only
   * until the answer.
   */
  track?: (work: Promise<unknown>) => void;
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
 * `promise`, or `TIMED_OUT` once `ms` have passed: a deadline that holds even
 * for a transport that does not stop when its signal aborts.
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
      const target = current;
      const request = (async () =>
        fetchResource(target, {
          headers: { Accept: options.accept },
          redirect: "manual",
          signal: controller.signal,
        }))();
      options.track?.(request);
      const response = await withDeadline(request, options.timeoutMs);
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
      const read = readLimited(response, options.maxBytes);
      options.track?.(read);
      const body = await withDeadline(read, options.timeoutMs);
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
