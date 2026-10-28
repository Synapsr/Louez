import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { after, connection } from "next/server";

import { answerBillingReturn } from "@/lib/billing/billing-return-handler";
import { getBillingSession } from "@/lib/billing/handoff-session";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore } from "@/lib/store-context";

/**
 * "Back to Louez" from the billing pages (louez-billing docs/api, README §10 step 4).
 * lib/billing/billing-return-handler.ts decides the answer. With LOUEZ_BILLING off the
 * proxy answers 404 first.
 *
 * Not wrapped in withEvlog, which would log the redirect as an error.
 */
export async function GET() {
  const answer = await answerBillingReturn({
    connection,
    after,
    getSession: getBillingSession,
    getStore: getCurrentStore,
    isPlatformAdmin,
    cookies,
  });
  if (answer.kind === "not_found") notFound();
  redirect(answer.to);
}
