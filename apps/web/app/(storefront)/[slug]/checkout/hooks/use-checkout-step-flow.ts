"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { StepId } from "../checkout.types";
import { getCheckoutStepIds } from "../util.checkout-steps";

type StepDirection = "forward" | "backward";

interface UseCheckoutStepFlowParams {
  isDeliveryEnabled: boolean;
  /** A cart line asks item-scope custom fields: "Détails de la location" follows the contact step. */
  hasDetailsStep: boolean;
  validateCurrentStep: (currentStep: StepId) => Promise<boolean>;
  /** Element scrolled into view when the step changes. */
  scrollTargetRef: RefObject<HTMLElement | null>;
}

export const useCheckoutStepFlow = ({
  isDeliveryEnabled,
  hasDetailsStep,
  validateCurrentStep,
  scrollTargetRef,
}: UseCheckoutStepFlowParams) => {
  const [currentStep, setCurrentStep] = useState<StepId>("contact");
  const [stepDirection, setStepDirection] = useState<StepDirection>("forward");
  const previousStepRef = useRef<StepId>("contact");

  const steps = useMemo(
    () => getCheckoutStepIds({ isDeliveryEnabled, hasDetailsStep }),
    [hasDetailsStep, isDeliveryEnabled],
  );

  const resolvedStep: StepId = steps.includes(currentStep) ? currentStep : steps[steps.length - 1];
  const currentStepIndex = steps.indexOf(resolvedStep);

  useEffect(() => {
    if (previousStepRef.current === resolvedStep) return;
    previousStepRef.current = resolvedStep;

    const target = scrollTargetRef.current;
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  }, [resolvedStep, scrollTargetRef]);

  const goToNextStep = useCallback(async () => {
    const isValid = await validateCurrentStep(resolvedStep);
    if (!isValid) return;

    const next = steps[currentStepIndex + 1];
    if (!next) return;

    setStepDirection("forward");
    setCurrentStep(next);
  }, [currentStepIndex, resolvedStep, steps, validateCurrentStep]);

  const goToPreviousStep = useCallback(() => {
    const previous = steps[currentStepIndex - 1];
    if (!previous) return;

    setStepDirection("backward");
    setCurrentStep(previous);
  }, [currentStepIndex, steps]);

  const goToStep = useCallback(
    (stepId: StepId) => {
      const targetIndex = steps.indexOf(stepId);
      if (targetIndex < 0 || targetIndex === currentStepIndex) return;

      setStepDirection(targetIndex > currentStepIndex ? "forward" : "backward");
      setCurrentStep(stepId);
    },
    [currentStepIndex, steps],
  );

  return {
    currentStep: resolvedStep,
    stepDirection,
    steps,
    currentStepIndex,
    isLastStep: currentStepIndex === steps.length - 1,
    goToNextStep,
    goToPreviousStep,
    goToStep,
  };
};
