import { notFound, redirect } from "next/navigation";
import { after, connection } from "next/server";

import { auth } from "@/lib/auth";
import { answerBillingReturn } from "@/lib/billing/billing-return-handler";
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
    getUserId: async () => (await auth())?.user?.id ?? null,
    getStore: getCurrentStore,
  });
  if (answer.kind === "not_found") notFound();
  redirect(answer.to);
}
