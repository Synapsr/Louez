'use client'

import { Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'

export interface PricingBand {
  from: number
  to: number | null
  priceCents: number
}

interface PayAsYouGoPricingProps {
  flatRateCents: number | null
  bands: PricingBand[]
  currency: string
}

/**
 * Presentational card showing the pay-as-you-go tariffs (graduated tier ladder or a
 * flat lifetime rate). Shared by the usage summary and the activation preview.
 */
export function PayAsYouGoPricing({
  flatRateCents,
  bands,
  currency,
}: PayAsYouGoPricingProps) {
  const t = useTranslations('dashboard.settings.subscription.payAsYouGo')
  const locale = useLocale()

  const money = (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          {t('pricingTitle')}
        </CardTitle>
        <CardDescription>
          {flatRateCents !== null
            ? t('pricingFlatDescription')
            : t('pricingTiersDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {flatRateCents !== null ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">{money(flatRateCents)}</span>
            <span className="text-muted-foreground">{t('perLocation')}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {bands.map((band, index) => (
              <li
                key={index}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <span className="text-muted-foreground">
                  {band.to === null
                    ? t('bandFromAbove', { from: band.from })
                    : t('bandRange', { from: band.from, to: band.to })}
                </span>
                <span className="font-medium">
                  {money(band.priceCents)} {t('perLocationShort')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
