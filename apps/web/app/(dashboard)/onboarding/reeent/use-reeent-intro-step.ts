"use client";

import { useCallback, useTransition } from "react";

import { useRouter } from "next/navigation";

import { useOnboardingErrorToast } from "../_lib/onboarding-error-toast";
import { useReeentIntro } from "../_lib/reeent-intro-context";
import { acknowledgeReeentIntro } from "./actions";

/**
 * Submits the reeent education step: the pro/particulier answer it asks up
 * front travels with the acknowledgment. The answer itself lives in the intro
 * context, since the explanation panel next to the step follows it live.
 */
export const useReeentIntroStep = () => {
  const router = useRouter();
  const showError = useOnboardingErrorToast();
  const { status } = useReeentIntro();
  const [isPending, startTransition] = useTransition();

  const submit = useCallback(() => {
    if (!status) return;

    startTransition(async () => {
      try {
        const result = await acknowledgeReeentIntro({ status });
        if ("error" in result) {
          throw new Error(result.error);
        }
        router.push("/onboarding/profile");
      } catch (error) {
        showError(error);
      }
    });
  }, [router, showError, status]);

  return { submit, isPending };
};
