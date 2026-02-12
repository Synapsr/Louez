import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { ProductStep, StepDirection } from '../types'

interface UseProductFormStepFlowParams {
  validateCurrentStep: (step: number) => Promise<boolean> | boolean
}

export function useProductFormStepFlow({
  validateCurrentStep,
}: UseProductFormStepFlowParams) {
  const t = useTranslations('dashboard.products.form')

  const steps = useMemo<ProductStep[]>(
    () => [
      {
        id: 'photos',
        title: t('steps.photos'),
        description: t('steps.photosDescription'),
      },
      {
        id: 'info',
        title: t('steps.info'),
        description: t('steps.infoDescription'),
      },
      {
        id: 'pricing',
        title: t('steps.pricing'),
        description: t('steps.pricingDescription'),
      },
      {
        id: 'preview',
        title: t('steps.preview'),
        description: t('steps.previewDescription'),
      },
    ],
    [t]
  )

  const [currentStep, setCurrentStep] = useState(0)
  const [stepDirection, setStepDirection] = useState<StepDirection>('forward')

  const goToNextStep = useCallback(async () => {
    if (currentStep >= steps.length - 1) return

    const isValid = await validateCurrentStep(currentStep)
    if (!isValid) return

    setStepDirection('forward')
    setCurrentStep((prev) => prev + 1)
  }, [currentStep, steps.length, validateCurrentStep])

  const goToPreviousStep = useCallback(() => {
    if (currentStep <= 0) return

    setStepDirection('backward')
    setCurrentStep((prev) => prev - 1)
  }, [currentStep])

  const goToStep = useCallback(
    (step: number) => {
      if (step < 0 || step >= steps.length || step >= currentStep) {
        return
      }

      setStepDirection('backward')
      setCurrentStep(step)
    },
    [currentStep, steps.length]
  )

  return {
    steps,
    currentStep,
    stepDirection,
    goToNextStep,
    goToPreviousStep,
    goToStep,
  }
}
