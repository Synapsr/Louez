import { after, NextResponse } from "next/server";

import { env as authEnv } from "@louez/auth/env";

import { env } from "@/env";
import { fillDemoPool } from "@/lib/demo/demo-pool";
import { isDemoVerticalKey } from "@/lib/demo/verticals";
import { isStandaloneMode } from "@/lib/deployment";
import { marketingOrigins } from "@/lib/marketing-session";

/**
 * The intent to open a demo: the louez.io site calls it when a visitor points
 * at, focuses or touches a « try the demo » button (`navigator.sendBeacon`), so
 * the trade's pool holds a store by the time they click. It only tops the pool
 * up to its size (lib/demo/demo-pool.ts): a call creates nothing for anyone,
 * and a thousand calls make no more stores than one. A bot that hovers
 * nothing never calls it. Only the app and the marketing site may ask.
 */
export async function POST(request: Request) {
  const vertical = new URL(request.url).searchParams.get("vertical");
  const origin = request.headers.get("origin");
  const allowed = [
    new URL(env.NEXT_PUBLIC_APP_URL).origin,
    ...marketingOrigins(authEnv.AUTH_URL, env.MARKETING_WEBSITE_ORIGINS),
  ];
  if (!isStandaloneMode() && isDemoVerticalKey(vertical) && origin && allowed.includes(origin)) {
    after(() => fillDemoPool(vertical));
  }
  // The same answer whatever happened: nothing to learn, nothing to wait for.
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
