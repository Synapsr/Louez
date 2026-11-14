import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { appRouter } from "@louez/api/router";
import { handoffDonePath, handoffPath } from "@louez/api/services/handoffs";
import { createRouterClient } from "@orpc/server";

import { apiPorts } from "@/lib/api/ports";
import {
  postedDecision,
  postedReason,
  postedRevision,
  postedShown,
  redirectTo,
  toLogin,
} from "@/lib/handoffs/handoff-response";
import { isSameOriginPost } from "@/lib/util.active-store-link";

import { env } from "@/env";

/**
 * A person approves or refuses a step on its page (an agent's team
 * invitation), with their own words if they add any. Only from this app's
 * pages (Origin, and Sec-Fetch-Site when sent), so another site cannot answer
 * with the owner's cookie. It calls the session-only procedure
 * `handoffs.decide` as the signed-in user, with the revision and what the
 * page showed; the procedure checks whose step it is, that they may still
 * decide it, and that the request is still what the page showed. A request
 * changed since the page showed it decides nothing: the page shows it again.
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

  const form = await request.formData();
  const decision = postedDecision(form);
  if (decision === null) return redirectTo(page, 303);
  const revision = postedRevision(form);
  const shown = postedShown(form);
  if (revision === null || shown === null) return redirectTo(`${page}?changed=1`, 303);

  const handoffs = createRouterClient(appRouter.dashboard.handoffs, {
    context: { headers: request.headers, transport: "rpc", ports: apiPorts },
    path: ["dashboard", "handoffs"],
  });
  try {
    const decided = await handoffs.decide({
      id: token,
      decision,
      reason: postedReason(form),
      revision,
      shown,
    });
    return redirectTo(handoffDonePath(decided.handoffId), 303);
  } catch (error) {
    const { code, details } =
      (error as { data?: { code?: unknown; details?: { reason?: unknown } } }).data ?? {};
    if (code === "UNAUTHENTICATED") return toLogin(page, 303);
    if (code === "HANDOFF_DECISION_INVALID" && details?.reason === "changed") {
      return redirectTo(`${page}?changed=1`, 303);
    }
    // An approval the answer ended (changed since, no seat, the day's
    // e-mails spent) sends the page on to its result, which says why; any
    // other refusal is shown by the page itself.
    return redirectTo(`${page}?error=failed`, 303);
  }
}
