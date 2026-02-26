import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { ReservationStep, ReservationStepId, StepDirection } from '../types'

interface UseNewReservationStepFlowParams {
  validateCurrentStep: () => boolean
  isDeliveryEnabled: boolean
}

export function useNewReservationStepFlow({
  validateCurrentStep,
  isDeliveryEnabled,
}: UseNewReservationStepFlowParams) {
  const t = useTranslations('dashboard.reservations.manualForm')

  const steps = useMemo<ReservationStep[]>(() => {
    const baseSteps: ReservationStep[] = [
      { id: 'customer', title: t('steps.customer'), description: t('steps.customerDescription') },
      { id: 'period', title: t('steps.period'), description: t('steps.periodDescription') },
      { id: 'products', title: t('steps.products'), description: t('steps.productsDescription') },
    ]

    if (isDeliveryEnabled) {
      baseSteps.push({
        id: 'delivery',
        title: t('steps.delivery'),
        description: t('steps.deliveryDescription'),
      })
    }

    baseSteps.push({
      id: 'confirm',
      title: t('steps.confirm'),
      description: t('steps.confirmDescription'),
    })

    return baseSteps
  }, [t, isDeliveryEnabled])

  const [currentStep, setCurrentStep] = useState(0)
  const [stepDirection, setStepDirection] = useState<StepDirection>('forward')

  const currentStepId: ReservationStepId | undefined = steps[currentStep]?.id

  const goToNextStep = useCallback(() => {
    if (!validateCurrentStep() || currentStep >= steps.length - 1) {
      return
    }

    setStepDirection('forward')
    setCurrentStep((prev) => prev + 1)
  }, [currentStep, steps.length, validateCurrentStep])

  const goToPreviousStep = useCallback(() => {
    if (currentStep <= 0) {
      return
    }

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
    currentStepId,
    stepDirection,
    goToNextStep,
    goToPreviousStep,
    goToStep,
  }
}
