"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import { toastManager } from "@louez/ui";

import { orpc } from "@/lib/orpc/react";
import {
  onboardingAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";

import { startStripeOnboarding } from "../../dashboard/settings/payments/actions";
import { useOnboardingErrorToast } from "./onboarding-error-toast";
import { useOnboardingSteps } from "./steps-context";
import { useOnboardingDraft } from "./use-onboarding-draft";

/**
 * Leaves onboarding for the Stripe-hosted KYC flow, from wherever the step
 * offers it: the generic side panel or the reeent variant's primary CTA.
 * Onboarding is completed in `payment` mode first so the Stripe callback lands
 * on a finished dashboard rather than back in the flow.
 */
export const useStripeConnectStart = ({ fromReeent }: { fromReeent: boolean }) => {
  const tErrors = useTranslations("errors");
  const showError = useOnboardingErrorToast();
  const posthog = usePostHog();
  const steps = useOnboardingSteps();
  const [isConnecting, setIsConnecting] = useState(false);

  // A KYC left midway keeps its Connect account: the CTA reads "resume" then.
  const draftQuery = useOnboardingDraft();
  const hasPendingAccount = draftQuery.data?.stripe?.hasPendingAccount ?? false;

  const completeOnboardingMutation = useMutation(
    orpc.dashboard.onboarding.complete.mutationOptions(),
  );

  // When the source step is still due, the Stripe KYC detour must come back
  // to it instead of the settings callback screen.
  const stripeReturnPath = steps.some((step) => step.path === "/onboarding/source")
    ? "/onboarding/source"
    : undefined;

  const startStripeConnect = async () => {
    setIsConnecting(true);
    // Captured before the Stripe redirect so the event has time to flush
    // while onboarding completion and account-link creation run.
    posthog.capture(productAnalyticsEvents.onboardingStripeConnectStarted, {
      ...onboardingAnalyticsBaseProperties,
      is_resume: hasPendingAccount,
      from_reeent: fromReeent,
    });
    try {
      await completeOnboardingMutation.mutateAsync({ reservationMode: "payment" });
      sessionStorage.setItem("louez-show-welcome", "1");
    } catch (error) {
      showError(error);
      setIsConnecting(false);
      return;
    }
    try {
      const result = await startStripeOnboarding(
        stripeReturnPath ? { next: stripeReturnPath } : undefined,
      );
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      toastManager.add({
        title: tErrors(result.error ? result.error.replace("errors.", "") : "generic"),
        type: "error",
      });
    } catch {
      toastManager.add({ title: tErrors("generic"), type: "error" });
    }
    setIsConnecting(false);
  };

  return { startStripeConnect, isConnecting, hasPendingAccount };
};
