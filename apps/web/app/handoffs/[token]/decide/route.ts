import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { appRouter } from "@louez/api/router";
import { handoffDonePath, handoffPath } from "@louez/api/services/handoffs";
import { createRouterClient } from "@orpc/server";

import { apiPorts } from "@/lib/api/ports";
import { redirectTo, toLogin } from "@/lib/handoffs/handoff-response";
import { isSameOriginPost } from "@/lib/util.active-store-link";

import { env } from "@/env";

/**
 * An owner approves or declines an agent's team invitation, from its page's
 * form. Only from this app's pages (Origin, and Sec-Fetch-Site when sent), so
 * another site cannot answer with the owner's cookie. It calls the
 * session-only procedure `team.decideInvitation` as the signed-in user; the
 * procedure checks the link, the user and their right to manage the team.
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
  const decision = form.get("decision");
  if (decision !== "approve" && decision !== "decline") return redirectTo(page, 303);

  const team = createRouterClient(appRouter.dashboard.team, {
    context: { headers: request.headers, transport: "rpc", ports: apiPorts },
    path: ["dashboard", "team"],
  });
  try {
    const decided = await team.decideInvitation({ token, decision });
    return redirectTo(handoffDonePath(decided.handoffId), 303);
  } catch (error) {
    const code = (error as { data?: { code?: unknown } }).data?.code;
    if (code === "UNAUTHENTICATED") return toLogin(page, 303);
    // The page says where the link stands now: answered, expired, or changed.
    return redirectTo(`${page}?error=${code === "TEAM_APPROVAL_CHANGED" ? "changed" : "failed"}`, 303);
  }
}
