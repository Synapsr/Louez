"use client";

import { useCallback } from "react";

import { usePathname } from "next/navigation";

import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import { toastManager } from "@louez/ui";

import { apiErrorKey } from "@/lib/orpc/errors";
import {
  onboardingAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";

import { getOnboardingStepKey } from "./steps";

function resolveErrorMessage(tErrors: (key: string) => string, error: unknown): string {
  // An agent-ready procedure's message is English for agents; its key is the dashboard's.
  const apiKey = apiErrorKey(error);
  if (apiKey) return tErrors(apiKey);
  if (error instanceof Error) {
    if (error.message.startsWith("errors.")) {
      return tErrors(error.message.replace("errors.", ""));
    }
    if (error.message.trim().length > 0) {
      return error.message;
    }
  }

  return tErrors("generic");
}

// Only well-known "errors.*" keys are sent to analytics: free-form messages
// could carry user input, and the key is what matters to locate the friction.
function resolveErrorKey(error: unknown): string {
  const apiKey = apiErrorKey(error);
  if (apiKey) return `errors.${apiKey}`;
  if (error instanceof Error && error.message.startsWith("errors.")) {
    return error.message;
  }
  return "unknown";
}

export function useOnboardingErrorToast() {
  const tErrors = useTranslations("errors");
  const pathname = usePathname();
  const posthog = usePostHog();

  return useCallback(
    (error: unknown) => {
      posthog.capture(productAnalyticsEvents.onboardingErrorShown, {
        ...onboardingAnalyticsBaseProperties,
        step: getOnboardingStepKey(pathname),
        error_key: resolveErrorKey(error),
      });

      toastManager.add({
        title: resolveErrorMessage(tErrors, error),
        type: "error",
      });
    },
    [pathname, posthog, tErrors],
  );
}
