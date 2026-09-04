import { eq } from "drizzle-orm";

import { getMarketplaceCohortStatus } from "@louez/api/services";
import { db, users } from "@louez/db";
import { type ReeentIntroStatus, profileSchema } from "@louez/validations";

import { env } from "@/env";
import { isReeentLoueur } from "@/lib/acquisition/signup-origin";
import { auth } from "@/lib/auth";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";

import { OnboardingShell } from "./_components/onboarding-shell";
import { getOnboardingSteps } from "./_lib/steps";

/** Explanations the reeent step walks through before it asks its question. */
const REEENT_INTRO_SLIDE_COUNT = 3;

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The three professional business types all map back to "Professionnel": the
 * profile step is what refines the answer, the reeent step only asks the status.
 */
function toReeentIntroStatus(businessType: string | null | undefined): ReeentIntroStatus | null {
  const parsed = profileSchema.shape.businessType.safeParse(businessType);
  if (!parsed.success) return null;
  return parsed.data === "individual" ? "individual" : "professional";
}

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  // The (dashboard) layout above already redirects unauthenticated users.
  const session = await auth();
  const [user, isPlatformAdmin] = await Promise.all([
    session?.user?.id
      ? db.query.users.findFirst({
          where: eq(users.id, session.user.id),
        })
      : null,
    isCurrentUserPlatformAdmin(),
  ]);

  // Needs the loaded user: the persisted origin outlives the cookie.
  const fromReeent = await isReeentLoueur(user);

  const needsProfile = !isPlatformAdmin && !user?.profileCompletedAt;

  // Live count, read on every render: the offer is the reason people finish
  // the reeent step, so a stale "places restantes" would be worse than none.
  // It is fetched here rather than in the step because the panel that shows it
  // is the shell's right column.
  const cohort = fromReeent
    ? await getMarketplaceCohortStatus(env.REEENT_LAUNCH_COHORT_SIZE)
    : null;

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
      fromReeent={fromReeent}
      initialPreview={{
        userName: user?.name ?? "",
        userImage: user?.image ?? null,
        userSeed: user?.id ?? "louez",
      }}
      reeentIntro={
        cohort
          ? {
              cohort,
              initialStatus: toReeentIntroStatus(user?.businessType),
              // Coming back to the step after acknowledging it lands on the
              // question: the explanations were already displayed once.
              initialPhase: user?.reeentIntroAcknowledgedAt ? REEENT_INTRO_SLIDE_COUNT : 0,
            }
          : null
      }
    >
      {children}
    </OnboardingShell>
  );
}
