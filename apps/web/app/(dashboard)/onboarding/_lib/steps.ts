export const ONBOARDING_STEPS = [
  { path: '/onboarding', labelKey: 'steps.store' },
  { path: '/onboarding/branding', labelKey: 'steps.branding' },
  { path: '/onboarding/stripe', labelKey: 'steps.payment' },
] as const;

export function getOnboardingStepIndex(pathname: string): number {
  return ONBOARDING_STEPS.findIndex((step) => step.path === pathname);
}
