import { after, NextResponse } from "next/server";
import { z } from "zod";

import { isTrustedAuthOrigin } from "@louez/auth";

import { ACTIVE_STORE_COOKIE, activeStoreCookieOptions } from "@/lib/active-store-cookie";
import { captureDemoEvent, demoAnalyticsEvents } from "@/lib/demo/demo-analytics";
import {
  DEMO_COOKIE,
  demoSessionCookieOptions,
  formatDemoSessionCookie,
} from "@/lib/demo/demo-session-cookie";
import { fillDemoPool } from "@/lib/demo/demo-pool";
import { startDemo } from "@/lib/demo/start-demo";
import { DEMO_VERTICAL_KEYS } from "@/lib/demo/verticals";
import { isStandaloneMode } from "@/lib/deployment";
import { getStorefrontUrl } from "@/lib/storefront-url";

const bodySchema = z.object({ vertical: z.enum(DEMO_VERTICAL_KEYS) });

/** How long the pool waits after a claim before writing the next store. */
const POOL_REFILL_DELAY_MS = 5_000;

/**
 * Opens a demo store for the visitor (lib/demo/start-demo.ts) and signs them
 * into it. Called by the /demo/<trade> page from the browser, never by a link:
 * a crawler following the website's buttons opens nothing.
 */
export async function POST(request: Request) {
  if (isStandaloneMode()) return new NextResponse(null, { status: 404 });

  // Only this app's own page: a cross-site form must not sign a visitor out of their account.
  const origin = request.headers.get("origin");
  if (!origin || !(await isTrustedAuthOrigin(origin))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { vertical } = parsed.data;

  const result = await startDemo({ vertical, headers: request.headers });
  // The next visitor's store, written a few seconds after this answer has left:
  // the visitor's first pages do not share the process with it.
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, POOL_REFILL_DELAY_MS));
    await fillDemoPool(vertical);
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, retryAfterSeconds: result.retryAfterSeconds ?? null },
      { status: result.error === "failed" ? 503 : 429 },
    );
  }

  // One store per visitor: the store id is the visitor's id in the demo's funnel.
  const visitorId = result.storeId;
  await captureDemoEvent({
    event: demoAnalyticsEvents.started,
    vertical,
    visitorId,
    headers: request.headers,
    properties: { source: result.source },
  });

  // The visitor starts as a customer of the store; the dashboard is one link away.
  const response = NextResponse.json({ redirectTo: getStorefrontUrl(result.slug) });
  response.cookies.set(ACTIVE_STORE_COOKIE, result.storeId, activeStoreCookieOptions);
  response.cookies.set(
    DEMO_COOKIE,
    formatDemoSessionCookie({ vertical, storeId: result.storeId, visitorId }),
    demoSessionCookieOptions,
  );
  // Appended last: `response.cookies` rewrites the Set-Cookie header it manages.
  for (const cookie of result.sessionHeaders.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
