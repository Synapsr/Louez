'use client'

import { useState, useTransition } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { ChevronRight, Loader2, Zap } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'

import { switchToPayAsYouGo } from './actions'
import {
  PayAsYouGoPricing,
  type PricingBand,
} from './pay-as-you-go-pricing'

interface PayAsYouGoPreviewProps {
  flatRateCents: number | null
  bands: PricingBand[]
  currency: string
  /** True when the store has an active paid plan → activation is deferred. */
  isPaidPlan: boolean
}

export function PayAsYouGoPreview({
  flatRateCents,
  bands,
  currency,
  isPaidPlan,
}: PayAsYouGoPreviewProps) {
  const t = useTranslations('dashboard.settings.subscription.payAsYouGo')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState(false)

  const handleActivate = () => {
    setError(false)
    startTransition(async () => {
      const result = await switchToPayAsYouGo()
      if (result?.error) {
        setError(true)
        return
      }
      router.push('/dashboard/subscription')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/subscription"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronRight className="h-4 w-4 rotate-180" />
        {t('backToPlans')}
      </Link>

      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Zap className="h-5 w-5" />
          {t('previewTitle')}
        </h2>
        <p className="text-muted-foreground">{t('previewDescription')}</p>
      </div>

      <PayAsYouGoPricing
        flatRateCents={flatRateCents}
        bands={bands}
        currency={currency}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('previewHowTitle')}</CardTitle>
          <CardDescription>{t('previewHowDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="error">
              <AlertDescription>{t('switchError')}</AlertDescription>
            </Alert>
          )}
          {isPaidPlan && (
            <Alert variant="warning">
              <AlertDescription>{t('deferredNote')}</AlertDescription>
            </Alert>
          )}
          <Button onClick={handleActivate} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('activate')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
