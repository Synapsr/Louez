'use client'

import { Progress } from '@louez/ui'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const t = useTranslations('onboarding')

  const ONBOARDING_STEPS = [
    { path: '/onboarding', labelKey: 'steps.store' },
    { path: '/onboarding/branding', labelKey: 'steps.branding' },
    { path: '/onboarding/stripe', labelKey: 'steps.payment' },
  ]

  const currentStepIndex = ONBOARDING_STEPS.findIndex(
    (step) => step.path === pathname
  )
  const progress = ((currentStepIndex + 1) / ONBOARDING_STEPS.length) * 100

  return (
    <div className="dashboard min-h-screen bg-muted/30">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Louez.io</h1>
          <p className="text-muted-foreground mt-1">
            {t('welcome.description')}
          </p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="mb-2 flex justify-between text-sm">
            {ONBOARDING_STEPS.map((step, index) => (
              <span
                key={step.path}
                className={
                  index <= currentStepIndex
                    ? 'text-primary font-medium'
                    : 'text-muted-foreground'
                }
              >
                {t(step.labelKey)}
              </span>
            ))}
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Content */}
        {children}
      </div>
    </div>
  )
}
