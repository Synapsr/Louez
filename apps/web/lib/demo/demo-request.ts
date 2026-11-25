import "server-only";

import { cookies, headers } from "next/headers";

import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

import { DEMO_COOKIE } from "./constants";

/**
 * Whether the request belongs to a demo (lib/demo): the visitor's browser holds
 * the demo cookie (the dashboard host), or the page is the storefront of a demo
 * store (the proxy names it in `x-store-slug`). The root layout then loads no
 * client analytics: a demo visitor is no business metric.
 */
export async function isDemoRequest(input: {
  headers: Pick<Headers, "get">;
  cookies: { has: (name: string) => boolean };
}): Promise<boolean> {
  if (input.cookies.has(DEMO_COOKIE)) return true;
  const slug = input.headers.get("x-store-slug");
  if (!slug) return false;
  return Boolean((await getStoreBySlug(slug))?.demoVertical);
}

/**
 * `isDemoRequest` for the current request, for a sender deep in a call: false
 * outside a request (a cron, an outbox run), where the store-level guards
 * (packages/db demo-stores.ts) apply instead.
 */
export async function isInDemoRequest(): Promise<boolean> {
  try {
    const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
    return await isDemoRequest({ headers: requestHeaders, cookies: cookieStore });
  } catch {
    return false;
  }
}
