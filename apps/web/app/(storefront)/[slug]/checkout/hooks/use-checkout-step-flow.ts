import { useCallback, useEffect, useMemo, useState } from 'react';

import { getCheckoutStepIds } from '../utils';
import type { CheckoutStep, DeliveryOption, StepId } from '../types';

type StepDirection = 'forward' | 'backward';

interface UseCheckoutStepFlowParams {
  isDeliveryEnabled: boolean;
  deliveryOption: DeliveryOption;
  requireCustomerAddress: boolean;
  stepIcons: Record<StepId, CheckoutStep['icon']>;
  validateCurrentStep: (currentStep: StepId) => Promise<boolean>;
}

export function useCheckoutStepFlow({
  isDeliveryEnabled,
  deliveryOption,
  requireCustomerAddress,
  stepIcons,
  validateCurrentStep,
}: UseCheckoutStepFlowParams) {
  const [currentStep, setCurrentStep] = useState<StepId>('contact');
  const [stepDirection, setStepDirection] = useState<StepDirection>('forward');

  const stepIds = useMemo(
    () =>
      getCheckoutStepIds({
        isDeliveryEnabled,
        deliveryOption,
        requireCustomerAddress,
      }),
    [isDeliveryEnabled, deliveryOption, requireCustomerAddress],
  );

  const steps = useMemo<CheckoutStep[]>(
    () => stepIds.map((id) => ({ id, icon: stepIcons[id] })),
    [stepIds, stepIcons],
  );

  useEffect(() => {
    if (!steps.some((step) => step.id === currentStep)) {
      setCurrentStep(steps[steps.length - 1].id);
    }
  }, [currentStep, steps]);

  const currentStepIndex = steps.findIndex((step) => step.id === currentStep);

  const goToNextStep = useCallback(async () => {
    const isValid = await validateCurrentStep(currentStep);
    if (!isValid) return;

    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= steps.length) return;

    setStepDirection('forward');
    setCurrentStep(steps[nextIndex].id);
  }, [currentStep, currentStepIndex, steps, validateCurrentStep]);

  const goToPreviousStep = useCallback(() => {
    const previousIndex = currentStepIndex - 1;
    if (previousIndex < 0) return;

    setStepDirection('backward');
    setCurrentStep(steps[previousIndex].id);
  }, [currentStepIndex, steps]);

  const goToStep = useCallback(
    (stepId: StepId) => {
      const targetIndex = steps.findIndex((step) => step.id === stepId);
      if (targetIndex < 0 || targetIndex === currentStepIndex) return;

      setStepDirection(targetIndex > currentStepIndex ? 'forward' : 'backward');
      setCurrentStep(stepId);
    },
    [currentStepIndex, steps],
  );

  return {
    currentStep,
    stepDirection,
    steps,
    currentStepIndex,
    goToNextStep,
    goToPreviousStep,
    goToStep,
  };
}
