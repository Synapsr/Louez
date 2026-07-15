export const ONBOARDING_STEPS = [
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

// The profile and source steps are user-level: they only appear the first
// time (profile not completed / acquisition channel not answered yet).
export function getOnboardingSteps(options: {
  needsProfile: boolean;
  needsSource: boolean;
}): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => {
    if (step.path === "/onboarding/profile") return options.needsProfile;
    if (step.path === "/onboarding/source") return options.needsSource;
    return true;
  });
}

export function getOnboardingStepIndex(steps: readonly OnboardingStep[], pathname: string): number {
  return steps.findIndex((step) => step.path === pathname);
}
