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

  // reeent never publishes a store that cannot charge online, so the loueurs it
  // sends over get the Stripe-only variant instead of the mode choice. Both go on
  // to the next step of the layout's flow.
  const fromReeent = await isReeentLoueur(user);

  return fromReeent ? <ReeentStripeClientPage /> : <OnboardingStripeClientPage />;
}
