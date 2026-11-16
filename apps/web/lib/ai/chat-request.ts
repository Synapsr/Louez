import { isSameOriginPost } from "@/lib/util.active-store-link";

/**
 * Whether a POST to the in-app assistant's chat endpoint may be read: it
 * comes from this app's own pages (`isSameOriginPost`, the guard of every
 * same-origin POST of the app: an `Origin` among `origins`, and
 * `Sec-Fetch-Site: same-origin` when the browser sends it), with a JSON
 * body, as the dashboard's chat sends it. Anything else is refused with the
 * guard's answer, a 403 that is never cached, before the session is read and
 * before any of the assistant's tools exists. Null: the request goes on.
 */
export function chatRequestRefusal(request: Request, appUrl: string): Response | null {
  const origins = [new URL(appUrl).origin, new URL(request.url).origin];
  const json = /^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "");
  if (isSameOriginPost(request.headers, origins) && json) return null;
  return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
}
