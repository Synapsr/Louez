import { eq } from "drizzle-orm";

import { db, users } from "@louez/db";

import { isReeentSignupOrigin } from "@/lib/acquisition/signup-origin";
import { auth } from "@/lib/auth";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";

import { OnboardingShell } from "./_components/onboarding-shell";
import { getOnboardingSteps } from "./_lib/steps";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  // The (dashboard) layout above already redirects unauthenticated users.
  const session = await auth();
  const [user, isPlatformAdmin, fromReeent] = await Promise.all([
    session?.user?.id
      ? db.query.users.findFirst({
          where: eq(users.id, session.user.id),
        })
      : null,
    isCurrentUserPlatformAdmin(),
    isReeentSignupOrigin(),
  ]);

  const needsProfile = !isPlatformAdmin && !user?.profileCompletedAt;

  // User-level steps only show up the first time. The step list is computed
  // once per full page load: completing a step mid-flow does not re-render
  // this layout, so the progress bar stays stable until the flow ends.
  const steps = getOnboardingSteps({
    // The reeent education step rides along with the profile step: it explains
    // what Louez is *before* the first question, and disappears with it. Basing
    // it on the "already seen" marker instead would shrink the progress bar
    // mid-flow, right after the user acknowledged the step.
    needsReeentIntro: fromReeent && needsProfile,
    needsProfile,
    needsSource: !user?.acquisitionChannel,
  });

  return (
    <OnboardingShell
      steps={steps}
      isPlatformAdmin={isPlatformAdmin}
      initialPreview={{
        userName: user?.name ?? "",
        userImage: user?.image ?? null,
        userSeed: user?.id ?? "louez",
      }}
    >
      {children}
    </OnboardingShell>
  );
}
