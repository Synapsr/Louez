// A handoff's URL holds a secret (the link's, or the provider return's state):
// it must reach no analytics, no log and no other site. These helpers mark the
// handoff pages for the root layout and check where the login goes back to;
// logs are redacted with packages/api platform/redact.ts.

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
