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
export type OnboardingStepPath = OnboardingStep["path"];

/** Where the flow goes once its last step is done. */
export const ONBOARDING_END_PATH = "/dashboard";

export function getOnboardingStepKey(pathname: string): OnboardingStepKey | null {
  return ONBOARDING_STEPS.find((step) => step.path === pathname)?.key ?? null;
}

// The reeent, profile and source steps are user-level: they only appear the
// first time (arrived from reeent / profile not completed / acquisition channel
// not answered yet). Everyone else goes straight from the store to its payments.
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

const stepOrder = (path: string) => ONBOARDING_STEPS.findIndex((step) => step.path === path);

/**
 * The step of this flow that comes after `path`, or the dashboard after the last one.
 * `path` itself need not be in the flow.
 */
export function getNextOnboardingPath(
  steps: readonly OnboardingStep[],
  path: OnboardingStepPath,
): OnboardingStepPath | typeof ONBOARDING_END_PATH {
  const after = stepOrder(path);
  return steps.find((step) => stepOrder(step.path) > after)?.path ?? ONBOARDING_END_PATH;
}

/**
 * Where Stripe's hosted KYC, started at the payment step, comes back to: the next step
 * of this flow (the source step), or null for the settings
 * callback screen when the flow ends with the payment step.
 */
export function getStripeKycReturnPath(
  steps: readonly OnboardingStep[],
): OnboardingStepPath | null {
  const next = getNextOnboardingPath(steps, "/onboarding/stripe");
  return next === ONBOARDING_END_PATH ? null : next;
}
