'use client'

import { useState, useTransition } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { ChevronRight, Zap } from 'lucide-react'
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
import { PayAsYouGoPricing, type PricingBand } from './pay-as-you-go-pricing'

type PayAsYouGoPreviewProps = {
  /** True when the store has an active paid plan → activation is deferred. */
  isPaidPlan: boolean
} & (
  | {
      /** Louez's own pricing, for a store Louez's legacy code bills. */
      flatRateCents: number | null
      bands: PricingBand[]
      currency: string
      offerLabel?: undefined
    }
  | {
      /**
       * For a store the billing service bills: the service's words for the offer it
       * returns to, in place of Louez's pricing; null until Louez holds a policy.
       */
      offerLabel: string | null
    }
)

export function PayAsYouGoPreview(props: PayAsYouGoPreviewProps) {
  const { isPaidPlan } = props
  const t = useTranslations('dashboard.settings.subscription.payAsYouGo')
  const tBilling = useTranslations('dashboard.settings.billing')
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
      router.push('/dashboard/settings/subscription')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/settings/subscription"
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

      {props.offerLabel === undefined ? (
        <PayAsYouGoPricing
          flatRateCents={props.flatRateCents}
          bands={props.bands}
          currency={props.currency}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardDescription>{tBilling('offerTitle')}</CardDescription>
            {props.offerLabel ? (
              <CardTitle className="text-2xl">{props.offerLabel}</CardTitle>
            ) : (
              <CardDescription>{tBilling('offerPending')}</CardDescription>
            )}
          </CardHeader>
        </Card>
      )}

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
          <Button onClick={handleActivate} isPending={isPending}>
            {t('activate')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
