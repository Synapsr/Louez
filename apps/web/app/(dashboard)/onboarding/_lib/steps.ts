export const ONBOARDING_STEPS = [
  { path: '/onboarding/profile', labelKey: 'steps.profile' },
  { path: '/onboarding', labelKey: 'steps.store' },
  { path: '/onboarding/branding', labelKey: 'steps.branding' },
  { path: '/onboarding/stripe', labelKey: 'steps.payment' },
  { path: '/onboarding/source', labelKey: 'steps.source' },
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

// The profile and source steps are user-level: they only appear the first
// time (profile not completed / acquisition channel not answered yet).
export function getOnboardingSteps(options: {
  needsProfile: boolean;
  needsSource: boolean;
}): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => {
    if (step.path === '/onboarding/profile') return options.needsProfile;
    if (step.path === '/onboarding/source') return options.needsSource;
    return true;
  });
}

export function getOnboardingStepIndex(
  steps: readonly OnboardingStep[],
  pathname: string,
): number {
  return steps.findIndex((step) => step.path === pathname);
}
