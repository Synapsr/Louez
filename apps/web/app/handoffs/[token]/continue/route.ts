import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import {
  continueHandoff,
  handoffDonePath,
  handoffPath,
  launchHandoff,
} from "@louez/api/services/handoffs";

import { auth } from "@/lib/auth";
import { handoffPorts, redirectTo, toLogin } from "@/lib/handoffs/handoff-response";
import { isSameOriginPost } from "@/lib/util.active-store-link";

import { env } from "@/env";

/**
 * The user continues a handoff to the provider, from its page's form. Only
 * from this app's pages (Origin, and Sec-Fetch-Site when sent), so another
 * site cannot start the step with the user's cookie; a link preview that
 * only loads the page starts nothing. The link's user, still allowed in the
 * store, goes to the provider; anyone else back to the page, which says why.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const origins = [new URL(env.NEXT_PUBLIC_APP_URL).origin, request.nextUrl.origin];
  if (!isSameOriginPost(request.headers, origins)) {
    return new NextResponse(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const { token } = await params;
  const page = handoffPath(token);

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return toLogin(page, 303);

  const continued = await continueHandoff(token, userId);
  if (!continued.ok || !continued.state) return redirectTo(page, 303);

  const launch = await launchHandoff({
    row: continued.row,
    state: continued.state,
    userId,
    locale: await getLocale(),
    ports: handoffPorts,
  });
  if (launch.ok) return redirectTo(launch.redirect, 303);
  // A provider that did not answer: the same link may try again.
  if (launch.retryable) return redirectTo(`${page}?retry=1`, 303);
  return redirectTo(handoffDonePath(continued.row.id), 303);
}
