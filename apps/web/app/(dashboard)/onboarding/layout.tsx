import { eq } from "drizzle-orm";

import { db, users } from "@louez/db";

import { auth } from "@/lib/auth";

import { OnboardingShell } from "./_components/onboarding-shell";
import { getOnboardingSteps } from "./_lib/steps";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  // The (dashboard) layout above already redirects unauthenticated users.
  const session = await auth();
  const user = session?.user?.id
    ? await db.query.users.findFirst({
        where: eq(users.id, session.user.id),
      })
    : null;

  // User-level steps only show up the first time. The step list is computed
  // once per full page load: completing a step mid-flow does not re-render
  // this layout, so the progress bar stays stable until the flow ends.
  const steps = getOnboardingSteps({
    needsProfile: !user?.profileCompletedAt,
    needsSource: !user?.acquisitionChannel,
  });

  return (
    <OnboardingShell
      steps={steps}
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
