"use client";

import { useEffect } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import { Button, Logo } from "@louez/ui";
import { ArrowLeftIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { useInstanceConfig } from "@/components/instance-provider";

import {
  onboardingAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";

import { OnboardingPreviewProvider, type OnboardingPreviewState } from "../_lib/preview-context";
import { ReeentIntroProvider, type ReeentIntroSeed } from "../_lib/reeent-intro-context";
import { type OnboardingStep, getOnboardingStepIndex } from "../_lib/steps";
import { OnboardingStepsProvider } from "../_lib/steps-context";
import { FounderNotePanel } from "./founder-note-panel";
import { OnboardingSceneBackdrop } from "./onboarding-scene-backdrop";
import { PaymentModePanel } from "./payment-mode-panel";
import { ReeentIntroPanel } from "./reeent-intro-panel";
import { StepTransition } from "./step-transition";
import { StorefrontPreview } from "./storefront-preview";

export function OnboardingShell({
  children,
  steps,
  initialPreview,
  isPlatformAdmin,
  fromReeent,
  reeentIntro,
}: {
  children: React.ReactNode;
  steps: OnboardingStep[];
  initialPreview?: Partial<OnboardingPreviewState>;
  isPlatformAdmin: boolean;
  /** Loueurs reeent sent over: some steps drop the choices reeent forbids. */
  fromReeent: boolean;
  /** Only set for people reeent sent over, the only ones who get that step. */
  reeentIntro: ReeentIntroSeed | null;
}) {
  const pathname = usePathname();
  const t = useTranslations("onboarding");
  // The platform admin area is billing only (app/admin): absent when billing is off.
  const { billingEnabled } = useInstanceConfig();
  const tAccount = useTranslations("dashboard.settings.accountSettings");
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
      includes_reeent_step: steps.some((s) => s.key === "reeent"),
    });
  }, [posthog, stepIndex, steps]);
  const isReeentStep = pathname === "/onboarding/reeent";
  const isProfileStep = pathname === "/onboarding/profile";
  const isStripeStep = pathname === "/onboarding/stripe";
  const isSourceStep = pathname === "/onboarding/source";

  // Steps that explain themselves in words replace the preview with a readable
  // panel; everything else keeps the live preview bleeding off the right edge.
  const sidePanel = isStripeStep ? (
    <PaymentModePanel fromReeent={fromReeent} />
  ) : isSourceStep ? (
    <FounderNotePanel />
  ) : isReeentStep ? (
    <ReeentIntroPanel />
  ) : null;
  const sidePanelKind = isStripeStep
    ? "payment"
    : isSourceStep
      ? "founder-note"
      : isReeentStep
        ? "reeent"
        : isProfileStep
          ? "none"
          : "storefront-preview";
  // The profile step has nothing to show yet: the form stands alone, and the
  // right column opens on the store step, when the storefront starts to exist.
  const hasSideColumn = !isProfileStep;

  const shell = (
    <OnboardingStepsProvider steps={steps}>
      <OnboardingPreviewProvider initial={initialPreview}>
        <div className="dashboard bg-background flex min-h-svh">
          {/* Left: form column */}
          <div className="flex w-full flex-col lg:flex-1">
            <header className="flex items-center justify-between gap-4 px-6 pt-8 lg:px-12">
              <Logo className="h-5 w-auto" />
              {isPlatformAdmin && billingEnabled && (
                <Button variant="ghost" size="sm" render={<Link href="/admin" />}>
                  <ArrowLeftIcon className="size-4" />
                  {tAccount("administration")}
                </Button>
              )}
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
                  {/* Each segment fills from the left as its step is reached,
                      and empties back towards the left when the flow goes back. */}
                  {steps.map((step, index) => (
                    <div key={step.path} className="bg-border h-[4px] flex-1 overflow-hidden rounded-full">
                      <div
                        className={cn(
                          "bg-foreground ease-lagon h-full origin-left transition-transform duration-500 motion-reduce:transition-none",
                          index <= currentStepIndex ? "scale-x-100" : "scale-x-0",
                        )}
                      />
                    </div>
                  ))}
                </div>

                <StepTransition stepKey={pathname} stepIndex={currentStepIndex}>
                  {children}
                </StepTransition>
              </div>
            </main>

            <footer className="px-6 pb-8 lg:px-12">
              <p className="text-muted-foreground text-xs">© Louez {new Date().getFullYear()}</p>
            </footer>
          </div>

          {/* Right: live preview, bleeds off the right edge like the moodboard.
            Steps that need words swap it for a readable panel instead. */}
          <aside
            aria-hidden={!hasSideColumn}
            className={cn(
              "bg-background ease-lagon relative hidden min-w-0 grow basis-0 items-center overflow-hidden border-l transition-[flex-grow,border-color] duration-700 motion-reduce:transition-none lg:flex",
              !hasSideColumn && "grow-0 border-l-transparent",
            )}
          >
            <OnboardingSceneBackdrop />
            {/* Fades only when the panel itself changes: the storefront preview
                stays put from the store step to the branding step. */}
            <StepTransition
              stepKey={sidePanelKind}
              stepIndex={currentStepIndex}
              slide={false}
              className={
                sidePanel
                  ? "relative mx-auto max-h-full w-full max-w-md overflow-y-auto px-10 py-10"
                  : "relative w-216 shrink-0 pl-10 xl:pl-16"
              }
            >
              {sidePanel ?? (hasSideColumn ? <StorefrontPreview /> : null)}
            </StepTransition>
          </aside>
        </div>
      </OnboardingPreviewProvider>
    </OnboardingStepsProvider>
  );

  return reeentIntro ? <ReeentIntroProvider {...reeentIntro}>{shell}</ReeentIntroProvider> : shell;
}
