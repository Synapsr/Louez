import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

import { dashboardPath, DASHBOARD_STORE_PARAM } from "@louez/api/platform/links";

import { auth } from "@/lib/auth";
import { getStoreSwitchState, switchActiveStore } from "@/lib/store-context";
import {
  ACTIVE_STORE_NEXT_PARAM,
  activeStoreConfirmPath,
  dashboardReturnPath,
  isSameOriginPost,
} from "@/lib/util.active-store-link";
import { createLoginUrl } from "@/lib/utils/util.url";

import { env } from "@/env";

/** The input: a store id (as the store switcher takes it) and the path to go back to. */
const inputSchema = z.object({
  [DASHBOARD_STORE_PARAM]: z.string().trim().max(64).catch(""),
  [ACTIVE_STORE_NEXT_PARAM]: z.string().max(2048).nullable().catch(null),
});

const readInput = (source: { get: (name: string) => unknown }) => {
  const input = inputSchema.parse({
    [DASHBOARD_STORE_PARAM]: source.get(DASHBOARD_STORE_PARAM) ?? "",
    [ACTIVE_STORE_NEXT_PARAM]: source.get(ACTIVE_STORE_NEXT_PARAM) ?? null,
  });
  return {
    storeId: input[DASHBOARD_STORE_PARAM],
    next: dashboardReturnPath(input[ACTIVE_STORE_NEXT_PARAM]),
  };
};

/** A same-origin redirect, never stored. */
const redirectTo = (path: string, status: 303 | 307) =>
  new NextResponse(null, {
    status,
    headers: { Location: path, "Cache-Control": "no-store" },
  });

/** Signed out: sign in first, and come back to the link with its store. */
const toLogin = (storeId: string, next: string, status: 303 | 307) =>
  redirectTo(
    createLoginUrl(storeId ? dashboardPath({ id: storeId }, next) : next, env.NEXT_PUBLIC_APP_URL),
    status,
  );

/**
 * A dashboard link that names its store (`/dashboard/…?store=<id>`), handed
 * here by the proxy. A GET never changes the active store, as any site can
 * make the browser follow a link: the same store, one the user may not open
 * and an unknown id all go to the same URL without the parameter (the answer
 * never tells whether a store exists); another store of the user goes to the
 * page where they confirm the switch. Signed out, the user signs in first and
 * comes back to the link with its store.
 */
export async function GET(request: NextRequest) {
  const { storeId, next } = readInput(request.nextUrl.searchParams);
  const state = await getStoreSwitchState(storeId);
  if (state.kind === "signed-out") return toLogin(storeId, next, 307);
  if (state.kind === "stay") return redirectTo(next, 307);
  return redirectTo(activeStoreConfirmPath(state.target.id, next), 307);
}

/**
 * The confirmed switch, posted by the confirmation page's form. Only from
 * this app's pages (Origin, and Sec-Fetch-Site when sent; the session cookie
 * is SameSite=Lax as well), and only to a store the user may open
 * (`switchActiveStore`, the store switcher's check). A refused or unknown
 * store changes nothing and gets the same answer.
 */
export async function POST(request: NextRequest) {
  const origins = [new URL(env.NEXT_PUBLIC_APP_URL).origin, request.nextUrl.origin];
  if (!isSameOriginPost(request.headers, origins)) {
    return new NextResponse(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const form = await request.formData().catch(() => new FormData());
  const { storeId, next } = readInput(form);

  const session = await auth();
  if (!session?.user?.id) return toLogin(storeId, next, 303);

  if (storeId) await switchActiveStore(storeId);
  return redirectTo(next, 303);
}
