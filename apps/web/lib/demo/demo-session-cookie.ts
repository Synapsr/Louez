import { DEMO_COOKIE, DEMO_STORE_TTL_HOURS } from "./constants";
import { isDemoVerticalKey, type DemoVerticalKey } from "./verticals/types";

/**
 * The visitor's demo, as the `louez_demo` cookie keeps it: the trade, the
 * store and the visitor id the demo's analytics events carry. It only says
 * where to go back to: access to the store is the session's.
 */
export interface DemoSessionCookie {
  vertical: DemoVerticalKey;
  storeId: string;
  visitorId: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const formatDemoSessionCookie = (value: DemoSessionCookie): string =>
  [value.vertical, value.storeId, value.visitorId].join(".");

export function parseDemoSessionCookie(raw: string | null | undefined): DemoSessionCookie | null {
  if (!raw) return null;
  const [vertical, storeId, visitorId, ...rest] = raw.split(".");
  if (rest.length > 0 || !isDemoVerticalKey(vertical)) return null;
  if (!storeId || !visitorId || !ID.test(storeId) || !ID.test(visitorId)) return null;
  return { vertical, storeId, visitorId };
}

export const demoSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: DEMO_STORE_TTL_HOURS * 60 * 60,
} as const;

export { DEMO_COOKIE };
