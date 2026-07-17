"use client";

import { createContext, useContext } from "react";

import type { OnboardingStep } from "./steps";

// The step list is computed once per full page load in the layout (user-level
// steps are conditional). Exposing it lets step pages adapt their navigation —
// e.g. the store step only shows "back" when the profile step was part of the
// flow — without re-deriving the list from the DB, which would already have
// flipped after the step was completed.
const OnboardingStepsContext = createContext<readonly OnboardingStep[]>([]);

export const OnboardingStepsProvider = ({
  steps,
  children,
}: {
  steps: readonly OnboardingStep[];
  children: React.ReactNode;
}) => {
  return (
    <OnboardingStepsContext.Provider value={steps}>{children}</OnboardingStepsContext.Provider>
  );
};

export const useOnboardingSteps = () => {
  return useContext(OnboardingStepsContext);
};
