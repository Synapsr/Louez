import { redirect } from "next/navigation";
import { after } from "next/server";

import { eq } from "drizzle-orm";

import { db, users } from "@louez/db";

import { auth } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing/billing-access";
import { showsBillingCardStep } from "@/lib/billing/billing-card-step";
import { withBillingReturnOutcome } from "@/lib/billing/billing-return";
import { BILLING_CARD_STEP_PATH } from "@/lib/billing/billing-routes";
import { finishCardReturn, readCheckoutSessionId } from "@/lib/billing/card-return";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore } from "@/lib/store-context";

import { BillingCardClientPage } from "./billing-card-client-page";
import { billingCardStepView } from "./billing-card-step-view";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The "Billing card" step (lib/billing/billing-card-step.ts): the owner enters the card
 * on Stripe Checkout, which comes back here with `?checkout=`. The card is saved, then
 * the page comes back once more with the toast's `?billing=`, and
 * billing-card-step-view.ts decides the answer.
 */
export default async function OnboardingBillingCardPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string; checkout?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [user, store, isPlatformAdmin] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { acquisitionChannel: true },
    }),
    getCurrentStore(),
    isCurrentUserPlatformAdmin(),
  ]);

  const { billing, checkout } = await searchParams;
  const checkoutSessionId = readCheckoutSessionId(checkout);
  if (store && checkoutSessionId) {
    const access = await getBillingAccess(store, isPlatformAdmin);
    if (access?.role === "owner") {
      const outcome = await finishCardReturn({ storeId: store.id, checkoutSessionId, after });
      redirect(withBillingReturnOutcome(BILLING_CARD_STEP_PATH, outcome));
    }
  }

  const view = billingCardStepView({
    shown: await showsBillingCardStep({
      userId: session.user.id,
      isPlatformAdmin,
      stores: store ? [store] : [],
    }),
    needsSource: !user?.acquisitionChannel,
    billing: billing ?? null,
  });
  if (view.kind === "redirect") redirect(view.to);

  return <BillingCardClientPage />;
}
