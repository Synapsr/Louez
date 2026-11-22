import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authInstance } from "@/lib/auth";
import { ACTIVE_STORE_COOKIE } from "@/lib/active-store-cookie";
import { isDemoOwnerEmail } from "@/lib/demo/constants";
import { captureDemoEvent, demoAnalyticsEvents } from "@/lib/demo/demo-analytics";
import { DEMO_COOKIE, parseDemoSessionCookie } from "@/lib/demo/demo-session-cookie";

import { env } from "@/env";

/**
 * « Créer ma boutique gratuite » from a demo store: counts the click
 * (`demo_signup_clicked`), signs the visitor out of the demo account and
 * sends them to the sign-up, where their own account starts empty. The demo
 * store stays until it expires.
 */
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const demo = parseDemoSessionCookie(cookieStore.get(DEMO_COOKIE)?.value);
  const response = NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_APP_URL));
  response.headers.set("Cache-Control", "no-store");

  if (demo) {
    await captureDemoEvent({
      event: demoAnalyticsEvents.signupClicked,
      vertical: demo.vertical,
      visitorId: demo.visitorId,
      headers: request.headers,
      properties: {
        from:
          new URL(request.url).searchParams.get("from") === "storefront"
            ? "storefront"
            : "dashboard",
      },
    });
  }

  // Only a demo account is signed out here: a real owner who followed the link keeps their session.
  const session = await authInstance.api.getSession({ headers: request.headers });
  response.cookies.delete(DEMO_COOKIE);
  if (session && isDemoOwnerEmail(session.user.email)) {
    response.cookies.delete(ACTIVE_STORE_COOKIE);
    const signedOut = await authInstance.api.signOut({
      headers: request.headers,
      asResponse: true,
    });
    // Appended last: `response.cookies` rewrites the Set-Cookie header it manages.
    for (const cookie of signedOut.headers.getSetCookie())
      response.headers.append("set-cookie", cookie);
  }
  return response;
}
