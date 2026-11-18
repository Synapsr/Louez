import { NextResponse, type NextRequest } from "next/server";

import { readTestModePass, TEST_MODE_COOKIE } from "@louez/api/services/test-reservation-token";

import { log } from "@/lib/evlog";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import {
  findTestModeMember,
  testModeCookieOptions,
} from "@/lib/test-reservations/storefront-test-mode";
import { testModeRoutePaths } from "@/lib/test-reservations/util.test-mode-route";
import { getStorefrontPathPrefix } from "@/lib/util.storefront-host";

/** A same-origin 303 to `location`, which nothing in the URL can turn into another host. */
const redirectTo = (location: string) =>
  new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      // The token is in this URL: no page it leads to learns it.
      "Referrer-Policy": "no-referrer",
    },
  });

/**
 * `/test-mode?token=…`: the dashboard's link that opens the store in test mode
 * (lib/test-reservations). A valid pass, for a member still in the store, becomes
 * the test-mode cookie, for the time the pass has left; anything else lands on the
 * store's home page without it. `/test-mode?leave=1` clears it.
 *
 * The store is found first, and every answer goes back to its home on the host the
 * visitor typed (the store's own host, or `/{slug}` on the dashboard's), where the
 * cookie lives: the redirect is relative, built from the store's slug as one path
 * segment (util.test-mode-route.ts). An unknown store lands on `/`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  try {
    const store = await getStoreBySlug(slug);
    if (!store) return redirectTo("/");
    const { home, cookiePath } = testModeRoutePaths(
      store.slug,
      (await getStorefrontPathPrefix(store.slug)) === "",
    );
    const response = redirectTo(home);

    if (request.nextUrl.searchParams.get("leave") === "1") {
      response.cookies.set(TEST_MODE_COOKIE, "", testModeCookieOptions(cookiePath, 0));
      return response;
    }

    const token = request.nextUrl.searchParams.get("token");
    const pass = readTestModePass(token, store.id);
    if (!token || !pass || !(await findTestModeMember(store.id, pass.userId))) return response;

    const maxAgeSeconds = Math.floor((pass.exp - Date.now()) / 1000);
    if (maxAgeSeconds <= 0) return response;
    // The cookie holds the pass itself: signed, bound to the store and the member.
    response.cookies.set(TEST_MODE_COOKIE, token, testModeCookieOptions(cookiePath, maxAgeSeconds));
    return response;
  } catch (error) {
    log.error(
      "test-reservations",
      `test mode entry failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return redirectTo("/");
  }
}
