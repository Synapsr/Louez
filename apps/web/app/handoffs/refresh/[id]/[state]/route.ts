import type { NextRequest } from "next/server";

import {
  checkHandoffReturn,
  handoffDonePath,
  refreshHandoffOnboarding,
} from "@louez/api/services/handoffs";

import { auth } from "@/lib/auth";
import { handoffPorts, redirectTo, toLogin } from "@/lib/handoffs/handoff-response";

/**
 * Stripe's onboarding link expired while the user was on it: Stripe sends
 * them here, and they go back to a new one for the same account. Same checks
 * as the return.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; state: string }> },
) {
  const { id, state } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return toLogin(request.nextUrl.pathname, 307);

  const checked = await checkHandoffReturn(id, state, userId);
  const url = checked.ok
    ? await refreshHandoffOnboarding({ row: checked.row, state, ports: handoffPorts })
    : null;
  return redirectTo(url ?? handoffDonePath(id), 307);
}
