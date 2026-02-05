'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import {
  FileCheck,
  CreditCard,
  Mail,
  CheckCircle2,
  Zap,
  Clock,
  AlertCircle,
  Lightbulb,
  Loader2,
} from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { Badge } from '@louez/ui'
import { Button } from '@louez/ui'

interface PaymentFlowExplanationProps {
  reservationMode: 'payment' | 'request'
  stripeChargesEnabled: boolean
  onConnectStripe?: () => Promise<void>
  isConnecting?: boolean
}

// Hook to animate through steps sequentially
function useStepAnimation(totalSteps: number, intervalMs: number = 2000) {
  const [activeStep, setActiveStep] = useState(1)

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev >= totalSteps ? 1 : prev + 1))
    }, intervalMs)

    return () => clearInterval(interval)
  }, [totalSteps, intervalMs])

  return activeStep
}

export function PaymentFlowExplanation({
  reservationMode,
  stripeChargesEnabled,
  onConnectStripe,
  isConnecting = false,
}: PaymentFlowExplanationProps) {
  const t = useTranslations('dashboard.settings.payments.flowExplanation')

  // Determine the current scenario
  const isRequestMode = reservationMode === 'request'
  const isPaymentMode = reservationMode === 'payment'
  const hasStripe = stripeChargesEnabled

  // Determine number of steps based on scenario
  const getStepCount = () => {
    if (isPaymentMode && hasStripe) return 3
    return 4
  }

  // Animation: cycle through steps every 2 seconds
  const activeStep = useStepAnimation(getStepCount(), 2000)

  // Scenario: Request mode without Stripe
  if (isRequestMode && !hasStripe) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                {t('title')}
              </CardTitle>
              <CardDescription>{t('subtitle')}</CardDescription>
            </div>
            <Badge variant="secondary" className="gap-1">
              <FileCheck className="h-3 w-3" />
              {t('modes.request')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current flow */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              {t('currentFlow')}
            </h4>
            <div className="flex flex-col gap-2">
              <FlowStep number={1} icon={FileCheck} text={t('steps.requestSubmitted')} isActive={activeStep === 1} />
              <FlowStep number={2} icon={Mail} text={t('steps.youReview')} isActive={activeStep === 2} />
              <FlowStep number={3} icon={CheckCircle2} text={t('steps.acceptOrReject')} isActive={activeStep === 3} />
              <FlowStep number={4} icon={CreditCard} text={t('steps.paymentOnSite')} isActive={activeStep === 4} />
            </div>
          </div>

          {/* Suggestion */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex gap-3">
              <Lightbulb className="h-5 w-5 shrink-0 text-primary" />
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('suggestions.enableStripe.title')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('suggestions.enableStripe.description')}
                </p>
                {onConnectStripe && (
                  <Button
                    size="sm"
                    className="mt-2"
                    onClick={onConnectStripe}
                    disabled={isConnecting}
                  >
                    {isConnecting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                    {t('suggestions.enableStripe.action')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Scenario: Request mode with Stripe
  if (isRequestMode && hasStripe) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                {t('title')}
              </CardTitle>
              <CardDescription>{t('subtitle')}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Badge variant="secondary" className="gap-1">
                <FileCheck className="h-3 w-3" />
                {t('modes.request')}
              </Badge>
              <Badge variant="default" className="gap-1">
                <CreditCard className="h-3 w-3" />
                {t('modes.stripeActive')}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current flow */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              {t('currentFlow')}
            </h4>
            <div className="flex flex-col gap-2">
              <FlowStep number={1} icon={FileCheck} text={t('steps.requestSubmitted')} isActive={activeStep === 1} />
              <FlowStep number={2} icon={Mail} text={t('steps.youReview')} isActive={activeStep === 2} />
              <FlowStep number={3} icon={CheckCircle2} text={t('steps.acceptOrReject')} isActive={activeStep === 3} />
              <FlowStep number={4} icon={CreditCard} text={t('steps.paymentOnlineOrSite')} isActive={activeStep === 4} />
            </div>
          </div>

          {/* Info box */}
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              {t('info.requestWithStripe')}
            </p>
          </div>

          {/* Suggestion */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex gap-3">
              <Lightbulb className="h-5 w-5 shrink-0 text-primary" />
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('suggestions.instantPayment.title')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('suggestions.instantPayment.description')}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Scenario: Payment mode without Stripe (should not happen, but handle it)
  if (isPaymentMode && !hasStripe) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                {t('title')}
              </CardTitle>
              <CardDescription>{t('subtitle')}</CardDescription>
            </div>
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              {t('modes.configRequired')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Warning */}
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">
                  {t('warnings.noStripeWithPayment.title')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('warnings.noStripeWithPayment.description')}
                </p>
                {onConnectStripe && (
                  <Button
                    size="sm"
                    className="mt-2"
                    onClick={onConnectStripe}
                    disabled={isConnecting}
                  >
                    {isConnecting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                    {t('suggestions.enableStripe.action')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Scenario: Payment mode with Stripe (ideal)
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              {t('title')}
            </CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant="default" className="gap-1">
              <Zap className="h-3 w-3" />
              {t('modes.instant')}
            </Badge>
            <Badge variant="default" className="gap-1">
              <CreditCard className="h-3 w-3" />
              {t('modes.stripeActive')}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current flow */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            {t('currentFlow')}
          </h4>
          <div className="flex flex-col gap-2">
            <FlowStep number={1} icon={CreditCard} text={t('steps.customerPays')} isActive={activeStep === 1} />
            <FlowStep number={2} icon={CheckCircle2} text={t('steps.reservationConfirmed')} isActive={activeStep === 2} />
            <FlowStep number={3} icon={Mail} text={t('steps.bothNotified')} isActive={activeStep === 3} />
          </div>
        </div>

        {/* Info box */}
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-900/20">
          <div className="flex gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-800 dark:text-green-200">
              {t('info.instantPayment')}
            </p>
          </div>
        </div>

        {/* Alternative */}
        <div className="rounded-lg border bg-muted/50 p-4">
          <div className="flex gap-3">
            <Lightbulb className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('alternatives.requestMode.title')}</p>
              <p className="text-sm text-muted-foreground">
                {t('alternatives.requestMode.description')}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface FlowStepProps {
  number: number
  icon: React.ComponentType<{ className?: string }>
  text: string
  isActive?: boolean
}

function FlowStep({ number, icon: Icon, text, isActive }: FlowStepProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 transition-all duration-300 ease-in-out ${
        isActive
          ? 'border-primary/40 bg-primary/5'
          : 'border-transparent bg-muted/50'
      }`}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-all duration-300 ${
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted-foreground/20 text-muted-foreground'
        }`}
      >
        {number}
      </div>
      <Icon
        className={`h-4 w-4 shrink-0 transition-all duration-300 ${
          isActive ? 'text-primary' : 'text-muted-foreground'
        }`}
      />
      <span
        className={`text-sm transition-all duration-300 ${
          isActive ? 'font-medium text-foreground' : ''
        }`}
      >
        {text}
      </span>
    </div>
  )
}
