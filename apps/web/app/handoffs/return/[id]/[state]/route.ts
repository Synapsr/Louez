import type { NextRequest } from "next/server";

import {
  checkHandoffReturn,
  finishHandoffReturn,
  handoffDonePath,
} from "@louez/api/services/handoffs";

import { auth } from "@/lib/auth";
import { readCheckoutSessionId } from "@/lib/billing/card-return";
import { handoffPorts, redirectTo, toLogin } from "@/lib/handoffs/handoff-response";

/**
 * Where the provider sends the user back (Stripe's onboarding, the billing
 * card's Checkout with `?checkout=<session>`). The state in the path is the
 * one their click minted, so a return cannot be forged for another click;
 * the user must be the link's, still allowed. It reads the outcome from the
 * provider, never from the URL, then shows where the step stands.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; state: string }> },
) {
  const { id, state } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return toLogin(`${request.nextUrl.pathname}${request.nextUrl.search}`, 307);

  const checked = await checkHandoffReturn(id, state, userId);
  if (checked.ok) {
    await finishHandoffReturn({
      row: checked.row,
      state,
      ports: handoffPorts,
      checkoutSessionId: readCheckoutSessionId(request.nextUrl.searchParams.get("checkout")),
    });
  }
  return redirectTo(handoffDonePath(id), 303);
}
