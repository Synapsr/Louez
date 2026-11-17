"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import type { StepId } from "../checkout.types";
import { getCheckoutStepIds } from "../util.checkout-steps";

type StepDirection = "forward" | "backward";

interface UseCheckoutStepFlowParams {
  isDeliveryEnabled: boolean;
  /** A cart line asks item-scope custom fields: "Détails de la location" follows the contact step. */
  hasDetailsStep: boolean;
  validateCurrentStep: (currentStep: StepId) => Promise<boolean>;
  /**
   * Whether the delivery step holds what the order needs (each address leg
   * chosen and priced). The step is left forward only then, whatever asks:
   * its button, a key, or a jump to a later step.
   */
  isDeliveryReady: boolean;
  /** Element scrolled into view when the step changes. */
  scrollTargetRef: RefObject<HTMLElement | null>;
}

export const useCheckoutStepFlow = ({
  isDeliveryEnabled,
  hasDetailsStep,
  validateCurrentStep,
  isDeliveryReady,
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
    if (resolvedStep === "delivery" && !isDeliveryReady) return;
    const isValid = await validateCurrentStep(resolvedStep);
    if (!isValid) return;

    const next = steps[currentStepIndex + 1];
    if (!next) return;

    setStepDirection("forward");
    setCurrentStep(next);
  }, [currentStepIndex, isDeliveryReady, resolvedStep, steps, validateCurrentStep]);

  const isLastStep = currentStepIndex === steps.length - 1;

  /** Enter in a field asks for the next step, as the step's button does. */
  const handleFormKeyDown = useCallback(
    (event: KeyboardEvent<HTMLFormElement>) => {
      if (event.key !== "Enter" || isLastStep) return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.getAttribute("role") === "combobox") {
        return;
      }
      event.preventDefault();
      void goToNextStep();
    },
    [goToNextStep, isLastStep],
  );

  const goToPreviousStep = useCallback(() => {
    const previous = steps[currentStepIndex - 1];
    if (!previous) return;

    setStepDirection("backward");
    setCurrentStep(previous);
  }, [currentStepIndex, steps]);

  const goToStep = useCallback(
    (stepId: StepId) => {
      const requestedIndex = steps.indexOf(stepId);
      if (requestedIndex < 0) return;
      // A jump past a delivery step still to complete stops on it.
      const deliveryIndex = steps.indexOf("delivery");
      const stopsOnDelivery =
        deliveryIndex >= 0 && requestedIndex > deliveryIndex && !isDeliveryReady;
      const targetIndex = stopsOnDelivery ? deliveryIndex : requestedIndex;
      if (targetIndex === currentStepIndex) return;

      setStepDirection(targetIndex > currentStepIndex ? "forward" : "backward");
      setCurrentStep(steps[targetIndex]);
    },
    [currentStepIndex, isDeliveryReady, steps],
  );

  return {
    currentStep: resolvedStep,
    stepDirection,
    steps,
    currentStepIndex,
    isLastStep,
    goToNextStep,
    handleFormKeyDown,
    goToPreviousStep,
    goToStep,
  };
};
