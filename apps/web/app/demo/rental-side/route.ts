import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authInstance } from "@/lib/auth";
import { isDemoOwnerEmail } from "@/lib/demo/constants";
import { findLatestVisitorBooking } from "@/lib/demo/rental-side";
import { DEMO_COOKIE, parseDemoSessionCookie } from "@/lib/demo/demo-session-cookie";

import { env } from "@/env";

/**
 * « Voir côté loueur » from a demo storefront: the booking the visitor made
 * last, in the dashboard, or the reservations when they have not booked yet.
 * Anyone else goes to the dashboard, which signs them in as usual.
 */
export async function GET(request: Request) {
  // The request's cookies first: they make the route dynamic, so the build
  // never runs it without the app's URL.
  const demo = parseDemoSessionCookie((await cookies()).get(DEMO_COOKIE)?.value);
  const session = await authInstance.api.getSession({ headers: request.headers });
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");

  let target = "/dashboard";
  if (demo && session && isDemoOwnerEmail(session.user.email)) {
    const booking = await findLatestVisitorBooking({
      userId: session.user.id,
      storeId: demo.storeId,
    });
    target = booking ? `/dashboard/reservations/${booking.id}` : "/dashboard/reservations";
  }

  const response = NextResponse.redirect(`${appUrl}${target}`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
