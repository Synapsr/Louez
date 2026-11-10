import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
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

const BODY_FORBIDDEN_STATUSES = new Set([204, 205, 304]);

/** What the transport may be given in tests: a local server, on plain HTTP. */
export interface PinnedTransportOptions {
  maxHeaderSize?: number;
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
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
 * identity. A redirect is returned, never followed.
 */
export function createPinnedTransport(options: PinnedTransportOptions = {}): GuardedFetch {
  const maxHeaderSize = options.maxHeaderSize ?? MAX_RESPONSE_HEADER_BYTES;
  const resolve =
    options.resolve ?? ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));
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
    const addresses = await resolve(hostname);
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
          signal: init?.signal ?? webRequest.signal,
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
   * deadline: a transport call, whose DNS lookup no signal cancels, and a
   * body read. A caller that bounds how many GETs run at once holds its
   * place until all of them have settled, not only until the answer.
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
