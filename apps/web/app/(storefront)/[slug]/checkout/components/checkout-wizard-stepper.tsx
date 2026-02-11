'use client';

import { Check, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@louez/utils';

import type { CheckoutStep, StepId } from '../types';

interface CheckoutWizardStepperProps {
  steps: CheckoutStep[];
  currentStep: StepId;
  onStepClick: (stepId: StepId) => void;
}

export function CheckoutWizardStepper({
  steps,
  currentStep,
  onStepClick,
}: CheckoutWizardStepperProps) {
  const t = useTranslations('storefront.checkout');
  const currentStepIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-center">
        {steps.map((step, index) => {
          const isActive = step.id === currentStep;
          const isCompleted = index < currentStepIndex;
          const Icon = step.icon;

          return (
            <div key={step.id} className="flex items-center">
              <button
                type="button"
                onClick={() => {
                  if (isCompleted) {
                    onStepClick(step.id);
                  }
                }}
                disabled={!isCompleted && !isActive}
                className={cn(
                  'flex items-center gap-2 rounded-full px-4 py-2 transition-all',
                  isActive && 'bg-primary text-primary-foreground',
                  isCompleted &&
                    'bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer',
                  !isActive && !isCompleted && 'text-muted-foreground',
                )}
              >
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium',
                    isActive && 'bg-primary-foreground/20',
                    isCompleted && 'bg-primary text-primary-foreground',
                    !isActive && !isCompleted && 'bg-muted',
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                <span className="hidden font-medium sm:inline">
                  {t(`steps.${step.id}`)}
                </span>
              </button>
              {index < steps.length - 1 && (
                <ChevronRight className="text-muted-foreground mx-2 h-5 w-5" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

