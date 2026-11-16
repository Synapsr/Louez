import { isSameOriginPost } from "@/lib/util.active-store-link";

/** Where the app is served: its configured URL, and the origins the auth layer trusts. */
export interface AppOrigins {
  appUrl: string;
  /** Whether the auth layer trusts an origin (`isTrustedAuthOrigin`, @louez/auth). */
  isTrusted: (origin: string) => boolean | Promise<boolean>;
}

/** Why a chat request was refused, for the server's log. */
export interface ChatRefusal {
  response: Response;
  reason: "origin" | "content_type";
  /** The request's `Origin`, as sent; null when it sent none. */
  origin: string | null;
}

/**
 * Whether a POST to the in-app assistant's chat endpoint may be read: it
 * comes from one of this app's own pages, by `isSameOriginPost` (the guard
 * of every same-origin POST of the app: an `Origin` among the app's, and
 * `Sec-Fetch-Site: same-origin` when the browser sends it), with a JSON
 * body, as the dashboard's chat sends it. The app's origins are its
 * configured URL and exactly the ones the auth layer trusts (its AUTH_URL,
 * its development hosts, `BETTER_AUTH_TRUSTED_ORIGINS`): never the URL the
 * request reached the server with, which is the upstream one behind a proxy,
 * nor a forwarded header. Anything else is refused with the guard's answer, a
 * 403 that is never cached, before the session is read and before any of the
 * assistant's tools exists. Null: the request goes on.
 */
export async function chatRequestRefusal(
  request: Request,
  app: AppOrigins,
): Promise<ChatRefusal | null> {
  const origin = request.headers.get("origin");
  const origins = [new URL(app.appUrl).origin];
  if (origin && (await app.isTrusted(origin))) origins.push(origin);
  const refuse = (reason: ChatRefusal["reason"]): ChatRefusal => ({
    response: new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } }),
    reason,
    origin,
  });
  if (!isSameOriginPost(request.headers, origins)) return refuse("origin");
  const json = /^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "");
  return json ? null : refuse("content_type");
}

/** How long one origin's refusals are logged once. */
export const REFUSAL_LOG_INTERVAL_MS = 10 * 60_000;
const REFUSAL_LOG_KEYS_MAX = 100;
const lastLogged = new Map<string, number>();

/**
 * The server's line for a refusal, or null while the same origin was logged
 * less than `REFUSAL_LOG_INTERVAL_MS` ago: the request's origin and why, and
 * nothing else of it (no cookie, no other header, no body). The origin is
 * cut to one short line.
 */
export function refusalLogLine(refusal: ChatRefusal, now = Date.now()): string | null {
  const origin =
    refusal.origin === null
      ? "none"
      : refusal.origin.replace(/[^\x20-\x7e]/g, "?").slice(0, 200);
  const key = `${refusal.reason}:${origin}`;
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < REFUSAL_LOG_INTERVAL_MS) return null;
  if (!lastLogged.has(key) && lastLogged.size >= REFUSAL_LOG_KEYS_MAX) {
    const oldest = lastLogged.keys().next().value;
    if (oldest !== undefined) lastLogged.delete(oldest);
  }
  lastLogged.set(key, now);
  return refusal.reason === "origin"
    ? `Chat request refused for its origin: Origin ${origin} is not among the configured origins (NEXT_PUBLIC_APP_URL, AUTH_URL, BETTER_AUTH_TRUSTED_ORIGINS). Open the dashboard on one of them.`
    : `Chat request refused: its body is not JSON (Origin ${origin}).`;
}
