export const ONBOARDING_STEPS = [
  { path: "/onboarding/reeent", key: "reeent", labelKey: "steps.reeent" },
  { path: "/onboarding/profile", key: "profile", labelKey: "steps.profile" },
  { path: "/onboarding", key: "store", labelKey: "steps.store" },
  { path: "/onboarding/branding", key: "branding", labelKey: "steps.branding" },
  { path: "/onboarding/stripe", key: "payment", labelKey: "steps.payment" },
  { path: "/onboarding/source", key: "source", labelKey: "steps.source" },
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStepKey = OnboardingStep["key"];

export function getOnboardingStepKey(pathname: string): OnboardingStepKey | null {
  return ONBOARDING_STEPS.find((step) => step.path === pathname)?.key ?? null;
}

// The reeent, profile and source steps are user-level: they only appear the
// first time (arrived from reeent / profile not completed / acquisition channel
// not answered yet). Everyone else sees exactly the flow they saw before.
export function getOnboardingSteps(options: {
  needsReeentIntro: boolean;
  needsProfile: boolean;
  needsSource: boolean;
}): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => {
    if (step.path === "/onboarding/reeent") return options.needsReeentIntro;
    if (step.path === "/onboarding/profile") return options.needsProfile;
    if (step.path === "/onboarding/source") return options.needsSource;
    return true;
  });
}

export function getOnboardingStepIndex(steps: readonly OnboardingStep[], pathname: string): number {
  return steps.findIndex((step) => step.path === pathname);
}
