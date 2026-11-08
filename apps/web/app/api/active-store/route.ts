import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

import { dashboardPath, DASHBOARD_STORE_PARAM } from "@louez/api/platform/links";

import { auth } from "@/lib/auth";
import { switchActiveStore } from "@/lib/store-context";
import { ACTIVE_STORE_NEXT_PARAM, dashboardReturnPath } from "@/lib/util.active-store-link";
import { createLoginUrl } from "@/lib/utils/util.url";

import { env } from "@/env";

/** The query: a store id (as the store switcher takes it) and the path to go back to. */
const querySchema = z.object({
  [DASHBOARD_STORE_PARAM]: z.string().trim().max(64).catch(""),
  [ACTIVE_STORE_NEXT_PARAM]: z.string().max(2048).nullable().catch(null),
});

/** A same-origin redirect; never stored, as it may set the active store. */
const redirectTo = (path: string) =>
  new NextResponse(null, {
    status: 307,
    headers: { Location: path, "Cache-Control": "no-store" },
  });

/**
 * A dashboard link that names its store (`/dashboard/…?store=<id>`), handed
 * here by the proxy. A signed-in user who may open the store (the store
 * switcher's check) gets it as their active store; then the browser goes to
 * the same URL without the parameter. A refused or unknown store changes
 * nothing and answers the same, so the answer never tells whether a store
 * exists. Signed out, the user signs in first and comes back to the link with
 * its store, which applies then.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = querySchema.parse({
    [DASHBOARD_STORE_PARAM]: searchParams.get(DASHBOARD_STORE_PARAM) ?? "",
    [ACTIVE_STORE_NEXT_PARAM]: searchParams.get(ACTIVE_STORE_NEXT_PARAM),
  });
  const storeId = query[DASHBOARD_STORE_PARAM];
  const next = dashboardReturnPath(query[ACTIVE_STORE_NEXT_PARAM]);

  const session = await auth();
  if (!session?.user?.id) {
    const back = storeId ? dashboardPath({ id: storeId }, next) : next;
    return redirectTo(createLoginUrl(back, env.NEXT_PUBLIC_APP_URL));
  }

  if (storeId) await switchActiveStore(storeId);
  return redirectTo(next);
}
