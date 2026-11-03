"use client";

import { useCallback, useTransition } from "react";

import { useRouter } from "next/navigation";

/**
 * Moves an onboarding step forward once its data is saved.
 *
 * `router.push` returns before the next page is rendered, so a step that only
 * tracks its mutation goes back to idle while the user is still looking at it,
 * and every extra click saves the step again. Running the push in a transition
 * keeps `isNavigating` true until the next step is on screen.
 *
 * The next step is deliberately not prefetched: its server checks (profile
 * done, store created) only pass once the current step is saved, so an early
 * prefetch could cache a redirect back to the step being left.
 */
export const useStepNavigation = (nextPath: string) => {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();

  const goToNextStep = useCallback(() => {
    startTransition(() => {
      router.push(nextPath);
    });
  }, [nextPath, router]);

  return { goToNextStep, isNavigating };
};
