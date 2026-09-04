import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { db, users } from "@louez/db";

import { isReeentLoueur } from "@/lib/acquisition/signup-origin";
import { auth } from "@/lib/auth";

import { ReeentStripeClientPage } from "./reeent-stripe-client-page";
import { OnboardingStripeClientPage } from "./stripe-client-page";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function OnboardingStripePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  });

  // Ask "how did you hear about us?" once, at the very end of the flow.
  const nextPath = user?.acquisitionChannel ? "/dashboard" : "/onboarding/source";

  // reeent never publishes a store that cannot charge online, so the loueurs it
  // sends over get the Stripe-only variant instead of the mode choice.
  const fromReeent = await isReeentLoueur(user);

  return fromReeent ? (
    <ReeentStripeClientPage nextPath={nextPath} />
  ) : (
    <OnboardingStripeClientPage nextPath={nextPath} />
  );
}
