import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { db, users } from "@louez/db";

import { auth } from "@/lib/auth";
import { showsBillingCardStep } from "@/lib/billing/billing-card-step";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore } from "@/lib/store-context";

import { BillingCardClientPage } from "./billing-card-client-page";
import { billingCardStepView } from "./billing-card-step-view";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The "Billing card" step (lib/billing/billing-card-step.ts): the owner adds the card
 * on the billing pages, through the hand-off, and the return comes back here with
 * `?billing=`. billing-card-step-view.ts decides the answer.
 */
export default async function OnboardingBillingCardPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
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

  const view = billingCardStepView({
    shown: await showsBillingCardStep({
      userId: session.user.id,
      isPlatformAdmin,
      stores: store ? [store] : [],
    }),
    needsSource: !user?.acquisitionChannel,
    billing: (await searchParams).billing ?? null,
  });
  if (view.kind === "redirect") redirect(view.to);

  return <BillingCardClientPage cardHref={view.cardHref} />;
}
