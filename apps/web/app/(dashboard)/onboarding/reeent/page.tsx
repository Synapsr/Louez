import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { getMarketplaceCohortStatus } from "@louez/api/services";
import { db, users } from "@louez/db";

import { isReeentSignupOrigin } from "@/lib/acquisition/signup-origin";
import { auth } from "@/lib/auth";

import { ReeentClientPage } from "./reeent-client-page";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function OnboardingReeentPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [user, fromReeent] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { profileCompletedAt: true },
    }),
    isReeentSignupOrigin(),
  ]);

  // Additive by construction: without the reeent origin cookie this route does
  // not exist for the user, and the flow is exactly the one shipped today.
  if (!fromReeent || user?.profileCompletedAt) {
    redirect("/onboarding/profile");
  }

  // Live count, read on every render: the offer is the reason people finish
  // this step, so a stale "places restantes" would be worse than none.
  const cohort = await getMarketplaceCohortStatus();

  return <ReeentClientPage remaining={cohort.remaining} total={cohort.total} />;
}
