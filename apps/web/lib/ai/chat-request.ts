import { isTrustedAppOrigin } from "@louez/auth/trusted-origins";

import { isSameOriginPost } from "@/lib/util.active-store-link";

/** The origins the app is served on: its configured URL, and those the auth layer trusts. */
export interface AppOrigins {
  appUrl: string;
  authUrl: string;
  development: boolean;
}

/**
 * Whether a POST to the in-app assistant's chat endpoint may be read: it
 * comes from one of this app's own pages, by `isSameOriginPost` (the guard
 * of every same-origin POST of the app: an `Origin` among the app's, and
 * `Sec-Fetch-Site: same-origin` when the browser sends it), with a JSON
 * body, as the dashboard's chat sends it. The app's origins are its
 * configured URL and the ones the auth layer trusts (`isTrustedAppOrigin`):
 * never the URL the request reached the server with, which is the upstream
 * one behind a proxy, nor a forwarded header. Anything else is refused with
 * the guard's answer, a 403 that is never cached, before the session is read
 * and before any of the assistant's tools exists. Null: the request goes on.
 */
export function chatRequestRefusal(request: Request, app: AppOrigins): Response | null {
  const origin = request.headers.get("origin");
  const origins = [new URL(app.appUrl).origin];
  if (origin && isTrustedAppOrigin(origin, app)) origins.push(origin);
  const json = /^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "");
  if (isSameOriginPost(request.headers, origins) && json) return null;
  return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
}
