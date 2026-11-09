// A handoff's URL holds a secret (the link's, or the provider return's state):
// it must reach no analytics, no log and no other site. These helpers mark the
// handoff pages for the root layout, and redact the secrets from log values.

/** Set by the proxy on a handoff request, never by a visitor: the root layout loads no analytics. */
export const HANDOFF_ROUTE_HEADER = "x-louez-handoff";

/** The handoff pages and routes (app/handoffs). */
export const isHandoffPath = (pathname: string): boolean =>
  pathname === "/handoffs" || pathname.startsWith("/handoffs/");

/** Whether the root layout may load client analytics and logging for this request. */
export const loadsClientAnalytics = (headers: Pick<Headers, "get">): boolean =>
  headers.get(HANDOFF_ROUTE_HEADER) !== "1";

/** A handoff path the login may send the user back to: a link, a return or a refresh, never elsewhere. */
const RESUMABLE =
  /^\/handoffs\/(?:[A-Za-z0-9_-]{64}|(?:return|refresh)\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{43}(?:\?checkout=cs_[A-Za-z0-9_]{1,250})?)$/;

export const resumableHandoffPath = (value: string | undefined): string | null =>
  value && RESUMABLE.test(value) ? value : null;

const SECRET = "[redacted]";
/** A return or refresh path: its state is a secret, its id is not. */
const STATE_PATH = /\/handoffs\/(return|refresh)\/([A-Za-z0-9_-]{1,64})\/[A-Za-z0-9_%-]+/g;
/** A link: the handoff's id (21 characters) then its secret. */
const LINK_PATH =
  /\/handoffs\/(?!return\/|refresh\/|done\/|resume\b)([A-Za-z0-9_-]{21})[A-Za-z0-9_%-]+/g;
/** The return of a login that passes through a link (an older callback). */
const ENCODED_PATH = /%2Fhandoffs%2F[A-Za-z0-9_%-]+/gi;

/** `text` with every handoff secret replaced, the ids kept. */
export function redactHandoffSecrets(text: string): string {
  return text
    .replace(STATE_PATH, `/handoffs/$1/$2/${SECRET}`)
    .replace(LINK_PATH, `/handoffs/$1${SECRET}`)
    .replace(ENCODED_PATH, `%2Fhandoffs%2F${SECRET}`);
}

/** A log value with every string redacted, objects and arrays walked. */
export function redactLogValue<T>(value: T): T {
  return redact(value, 0) as T;
}

function redact(value: unknown, depth: number): unknown {
  if (typeof value === "string") return redactHandoffSecrets(value);
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  if (value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redact(entry, depth + 1)]),
  );
}
