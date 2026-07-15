"use client";

import { useEffect } from "react";

import { usePathname } from "next/navigation";

import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import { Logo } from "@louez/ui";
import { cn } from "@louez/utils";

import {
  onboardingAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";

import { OnboardingPreviewProvider, type OnboardingPreviewState } from "../_lib/preview-context";
import { type OnboardingStep, getOnboardingStepIndex } from "../_lib/steps";
import { DashboardPreview } from "./dashboard-preview";
import { FounderNotePanel } from "./founder-note-panel";
import { PaymentModePanel } from "./payment-mode-panel";
import { StorefrontPreview } from "./storefront-preview";

export function OnboardingShell({
  children,
  steps,
  initialPreview,
}: {
  children: React.ReactNode;
  steps: OnboardingStep[];
  initialPreview?: Partial<OnboardingPreviewState>;
}) {
  const pathname = usePathname();
  const t = useTranslations("onboarding");
  const posthog = usePostHog();
  const stepIndex = getOnboardingStepIndex(steps, pathname);
  const currentStepIndex = stepIndex < 0 ? 0 : stepIndex;

  useEffect(() => {
    if (stepIndex < 0) return;
    const step = steps[stepIndex];

    posthog.capture(productAnalyticsEvents.onboardingStepViewed, {
      ...onboardingAnalyticsBaseProperties,
      step: step.key,
      step_index: stepIndex,
      steps_total: steps.length,
      // The user-level steps are conditional: keep the flow shape on every
      // event so funnels can compare short and long variants.
      includes_profile_step: steps.some((s) => s.key === "profile"),
      includes_source_step: steps.some((s) => s.key === "source"),
    });
  }, [posthog, stepIndex, steps]);
  const isProfileStep = pathname === "/onboarding/profile";
  const isStripeStep = pathname === "/onboarding/stripe";
  const isSourceStep = pathname === "/onboarding/source";
  // When the source step is still due, the Stripe KYC detour must come back
  // to it instead of the settings callback screen.
  const stripeReturnPath = steps.some((step) => step.path === "/onboarding/source")
    ? "/onboarding/source"
    : undefined;

  return (
    <OnboardingPreviewProvider initial={initialPreview}>
      <div className="dashboard bg-background flex min-h-svh">
        {/* Left: form column */}
        <div className="flex w-full flex-col lg:flex-1">
          <header className="px-6 pt-8 lg:px-12">
            <Logo className="h-5 w-auto" />
          </header>

          <main className="flex flex-1 flex-col justify-center px-6 py-10 lg:px-12">
            <div className="mx-auto w-full max-w-md">
              <div
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={steps.length}
                aria-valuenow={currentStepIndex + 1}
                aria-label={t("welcome.description")}
                className="mb-10 flex gap-1.5"
              >
                {steps.map((step, index) => (
                  <div
                    key={step.path}
                    className={cn(
                      "h-[4px] flex-1 rounded-full transition-colors duration-500",
                      index <= currentStepIndex ? "bg-foreground" : "bg-border",
                    )}
                  />
                ))}
              </div>

              {children}
            </div>
          </main>

          <footer className="px-6 pb-8 lg:px-12">
            <p className="text-muted-foreground text-xs">© Louez {new Date().getFullYear()}</p>
          </footer>
        </div>

        {/* Right: live preview, bleeds off the right edge like the moodboard.
            The stripe step swaps it for a readable mode explainer instead. */}
        <aside className="bg-muted/30 relative hidden flex-1 items-center overflow-hidden border-l lg:flex lg:flex-1">
          {isStripeStep || isSourceStep ? (
            <div className="mx-auto max-h-full w-full max-w-md overflow-y-auto px-10 py-10">
              {isStripeStep ? (
                <PaymentModePanel stripeReturnPath={stripeReturnPath} />
              ) : (
                <FounderNotePanel />
              )}
            </div>
          ) : (
            <div className="w-216 shrink-0 pl-10 xl:pl-16">
              {isProfileStep ? <DashboardPreview /> : <StorefrontPreview />}
            </div>
          )}
        </aside>
      </div>
    </OnboardingPreviewProvider>
  );
}
