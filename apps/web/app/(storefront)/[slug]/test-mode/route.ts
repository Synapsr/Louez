import { NextResponse, type NextRequest } from "next/server";

import { readTestModePass, TEST_MODE_COOKIE } from "@louez/api/services/test-reservation-token";

import { log } from "@/lib/evlog";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import {
  findTestModeMember,
  testModeCookieOptions,
} from "@/lib/test-reservations/storefront-test-mode";
import { getStorefrontPathPrefix } from "@/lib/util.storefront-host";

/**
 * `/test-mode?token=…`: the dashboard's link that opens the store in test mode
 * (lib/test-reservations). A valid pass, for a member still in the store, becomes
 * the test-mode cookie, for the time the pass has left; anything else lands on the
 * store's home page without it. `/test-mode?leave=1` clears it.
 *
 * Every answer goes back to the store's home on the host the visitor typed (the
 * store's own host, or `/{slug}` on the dashboard's), where the cookie lives: the
 * redirect is relative for that reason.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prefix = await getStorefrontPathPrefix(slug);
  const cookiePath = prefix || "/";
  const home = new NextResponse(null, {
    status: 303,
    headers: {
      Location: `${prefix}/`,
      "Cache-Control": "no-store",
      // The token is in this URL: no page it leads to learns it.
      "Referrer-Policy": "no-referrer",
    },
  });

  if (request.nextUrl.searchParams.get("leave") === "1") {
    home.cookies.set(TEST_MODE_COOKIE, "", testModeCookieOptions(cookiePath, 0));
    return home;
  }

  try {
    const store = await getStoreBySlug(slug);
    if (!store) return home;
    const token = request.nextUrl.searchParams.get("token");
    const pass = readTestModePass(token, store.id);
    if (!token || !pass || !(await findTestModeMember(store.id, pass.userId))) return home;

    const maxAgeSeconds = Math.floor((pass.exp - Date.now()) / 1000);
    if (maxAgeSeconds <= 0) return home;
    // The cookie holds the pass itself: signed, bound to the store and the member.
    home.cookies.set(TEST_MODE_COOKIE, token, testModeCookieOptions(cookiePath, maxAgeSeconds));
    return home;
  } catch (error) {
    log.error(
      "test-reservations",
      `test mode entry failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return home;
  }
}
