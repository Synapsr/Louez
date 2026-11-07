import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";

/**
 * The website icon of an OAuth client whose domain is proven: a client that
 * identifies itself by the URL of its metadata document (CIMD), so the host
 * of that URL served what it declares. Louez fetches the icon itself and
 * serves it from its own origin: the browser never loads an image from the
 * client's site, and the app's CSP stays closed.
 *
 * Every request goes through the CIMD transport: HTTPS only, every DNS
 * answer must be public, the connection is pinned to the checked address,
 * and redirects are never followed by it. This module adds what the CIMD
 * plugin adds around it: a timeout, a size cap, and redirects followed by
 * hand, each hop checked again. Only raster images are kept, recognized by
 * their bytes, never SVG.
 */

/** Largest icon kept, in bytes. */
export const MAX_ICON_BYTES = 100 * 1024;
/** Largest part of the home page read to find its icon links. */
const MAX_HTML_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 4000;
/** Time given to find one site's icon, every request and DNS lookup included. */
const RESOLVE_BUDGET_MS = 10_000;
/** Icon lookups running at once, across all sites; past it, an ask gets no icon. */
const MAX_IN_FLIGHT = 8;
const MAX_REDIRECTS = 3;
/** Icon links of the home page tried, at most. */
const MAX_LINK_CANDIDATES = 3;

/** The image types served, each with the Content-Type it is served with. */
export const ICON_CONTENT_TYPES = {
  png: "image/png",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
} as const;
export type IconType = keyof typeof ICON_CONTENT_TYPES;

export interface SiteIcon {
  contentType: (typeof ICON_CONTENT_TYPES)[IconType];
  body: Uint8Array;
}

/** A guarded GET, the CIMD transport's signature. Injected in tests. */
export type IconFetch = ClientMetadataResourceFetch;

/**
 * The origin whose icon stands for a CIMD client: the origin of its
 * client_id, an HTTPS URL. Null for anything else (a client id of a
 * dynamically registered client, plain HTTP, credentials in the URL).
 */
export function clientIconOrigin(clientId: string): string | null {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  return url.origin;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) =>
  bytes.length >= offset + prefix.length &&
  prefix.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** The raster type of an image, read from its first bytes. Null for anything else, SVG included. */
export function sniffIconType(bytes: Uint8Array): IconType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // An ICO header: reserved 0, type 1, at least one image.
  if (
    startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) &&
    bytes.length >= 6 &&
    (bytes[4] ?? 0) + (bytes[5] ?? 0) > 0
  ) {
    return "ico";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  return null;
}

/** The icon for these bytes, or null when they are not a raster image or are too large. */
export function toSiteIcon(bytes: Uint8Array): SiteIcon | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) return null;
  const type = sniffIconType(bytes);
  return type ? { contentType: ICON_CONTENT_TYPES[type], body: bytes } : null;
}

/** The body, or null as soon as it passes `maxBytes`. */
async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
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
        return null;
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

/**
 * `promise`, or null once `ms` have passed. The transport's abort signal
 * does not cover its DNS lookup, so a deadline must not wait for it.
 */
function withDeadline<T>(promise: T | Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    // A hung lookup must not keep the process alive.
    timer.unref?.();
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * GET `url` and read at most `maxBytes` of a 200 answer, following up to
 * three redirects to HTTPS URLs only. Null on any failure.
 */
async function getLimited(
  fetchResource: IconFetch,
  url: string,
  accept: string,
  maxBytes: number,
): Promise<{ url: string; body: Uint8Array } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (new URL(current).protocol !== "https:") return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await withDeadline(
        fetchResource(current, {
          headers: { Accept: accept },
          redirect: "manual",
          signal: controller.signal,
        }),
        REQUEST_TIMEOUT_MS,
      );
      if (!response) return null;
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => {});
        const location = response.headers.get("location");
        if (!location) return null;
        current = new URL(location, current).href;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      const body = await withDeadline(readLimited(response, maxBytes), REQUEST_TIMEOUT_MS);
      if (!body) controller.abort();
      return body ? { url: current, body } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(
    tag,
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
};

/**
 * The icon URLs a page declares in its `<link>` tags, `icon` links first,
 * then `apple-touch-icon` ones. SVG links are left out, and only HTTPS URLs
 * are kept.
 */
export function iconLinks(html: string, pageUrl: string): string[] {
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);
  const icons: string[] = [];
  const touchIcons: string[] = [];
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attribute(tag, "href");
    if (!href) continue;
    const type = (attribute(tag, "type") ?? "").toLowerCase();
    let url: URL;
    try {
      url = new URL(href.trim(), pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || type.includes("svg") || /\.svgz?$/i.test(url.pathname)) {
      continue;
    }
    if (rel.includes("icon")) icons.push(url.href);
    else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) {
      touchIcons.push(url.href);
    }
  }
  return [...new Set([...icons, ...touchIcons])];
}

/**
 * The icon of the site at `origin`: `/favicon.ico` first (one request, and
 * where most sites keep it), then the icon links of the home page. Null when
 * none is a raster image within the size cap.
 */
export async function fetchSiteIcon(
  origin: string,
  fetchResource: IconFetch = fetchClientMetadataResource,
): Promise<SiteIcon | null> {
  const accept = "image/png,image/x-icon,image/*;q=0.8";
  const favicon = await getLimited(fetchResource, `${origin}/favicon.ico`, accept, MAX_ICON_BYTES);
  const icon = favicon ? toSiteIcon(favicon.body) : null;
  if (icon) return icon;

  const page = await getLimited(fetchResource, `${origin}/`, "text/html", MAX_HTML_BYTES);
  if (!page) return null;
  const html = new TextDecoder().decode(page.body);
  for (const link of iconLinks(html, page.url).slice(0, MAX_LINK_CANDIDATES)) {
    const found = await getLimited(fetchResource, link, accept, MAX_ICON_BYTES);
    const linked = found ? toSiteIcon(found.body) : null;
    if (linked) return linked;
  }
  return null;
}

/** A found icon is kept a day; a missing one an hour, so a page view never fetches again. */
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

/**
 * Site icons by origin, in memory. Found and missing icons are both kept for
 * a while, the oldest entry goes first past 500, and concurrent asks for one
 * origin share one fetch.
 *
 * At most 8 lookups run at once, and a lookup that is still running (a slow
 * DNS answer, say) keeps its place until it ends, even after its asker got
 * no icon at the 10-second budget. A lookup refused because 8 run gets no
 * icon and leaves nothing in the cache, so a later ask tries again.
 */
export function createSiteIconCache(options?: {
  fetchResource?: IconFetch;
  now?: () => number;
  /** Tests shorten the budget. */
  resolveBudgetMs?: number;
}) {
  const fetchResource = options?.fetchResource ?? fetchClientMetadataResource;
  const now = options?.now ?? Date.now;
  const resolveBudgetMs = options?.resolveBudgetMs ?? RESOLVE_BUDGET_MS;
  const entries = new Map<string, { icon: SiteIcon | null; expiresAt: number }>();
  const pending = new Map<string, Promise<SiteIcon | null>>();
  let running = 0;

  return async function siteIcon(origin: string): Promise<SiteIcon | null> {
    const entry = entries.get(origin);
    if (entry && entry.expiresAt > now()) return entry.icon;
    const inFlight = pending.get(origin);
    if (inFlight) return inFlight;

    if (running >= MAX_IN_FLIGHT) return null;

    running++;
    const lookup = fetchSiteIcon(origin, fetchResource)
      .catch(() => null)
      .finally(() => {
        running--;
      });
    const request = withDeadline(lookup, resolveBudgetMs)
      .then((icon) => {
        entries.delete(origin);
        entries.set(origin, { icon, expiresAt: now() + (icon ? FOUND_TTL_MS : MISSING_TTL_MS) });
        while (entries.size > MAX_ENTRIES) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          entries.delete(oldest);
        }
        return icon;
      })
      .finally(() => pending.delete(origin));
    pending.set(origin, request);
    return request;
  };
}
