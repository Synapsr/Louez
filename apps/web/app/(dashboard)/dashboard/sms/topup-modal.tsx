'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { Loader2, CreditCard, Sparkles, Check, X, MessageSquare, ArrowRight } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { Button } from '@louez/ui'
import { cn } from '@louez/utils'
import { SMS_TOPUP_PACKAGES } from '@/lib/plans'
import { createTopupCheckout } from './actions'

interface TopupModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  priceCents: number
  planSlug: string
}

// Plan details for comparison
const PLAN_DETAILS = {
  pro: { smsIncluded: 50, topupPrice: '0,15€', price: 29 },
  ultra: { smsIncluded: 500, topupPrice: '0,07€', price: 79 },
}

export function TopupModal({ open, onOpenChange, priceCents, planSlug }: TopupModalProps) {
  const t = useTranslations('dashboard.sms.topup')
  const locale = useLocale()
  const [selectedPackage, setSelectedPackage] = useState<number>(100)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUpsell, setShowUpsell] = useState(true)

  const priceEuros = priceCents / 100
  const isPro = planSlug === 'pro'
  const isStart = planSlug === 'start'

  const handlePurchase = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await createTopupCheckout(selectedPackage, locale)

      if (result.success && result.url) {
        window.location.href = result.url
      } else {
        setError(result.error || t('errors.generic'))
      }
    } catch {
      setError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }

  const formatPrice = (cents: number) => {
    return (cents / 100).toFixed(2).replace('.', ',') + '€'
  }

  // Start plan users see upgrade prompt with plan comparison
  if (isStart) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              {t('upsell.startTitle')}
            </DialogTitle>
            <DialogDescription>{t('upsell.startDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Plan comparison */}
            <div className="grid grid-cols-2 gap-3">
              {/* Pro Plan */}
              <div className="relative flex flex-col rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm">
                <div className="mb-3">
                  <h3 className="font-semibold">Pro</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-primary">{PLAN_DETAILS.pro.price}€</span>
                    <span className="text-xs text-muted-foreground">{t('upsell.month')}</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                      <Check className="h-3 w-3 text-primary" />
                    </div>
                    <span>{t('upsell.smsIncluded', { count: PLAN_DETAILS.pro.smsIncluded })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                      <Sparkles className="h-3 w-3" />
                    </div>
                    <span>{t('upsell.topupPrice', { price: PLAN_DETAILS.pro.topupPrice })}</span>
                  </div>
                </div>
              </div>

              {/* Ultra Plan */}
              <div className="relative flex flex-col rounded-xl border-2 border-primary bg-gradient-to-br from-primary/5 via-primary/5 to-primary/10 p-4 shadow-sm shadow-primary/10">
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
                  {t('upsell.recommended')}
                </span>
                <div className="mb-3">
                  <h3 className="font-semibold">Ultra</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-primary">{PLAN_DETAILS.ultra.price}€</span>
                    <span className="text-xs text-muted-foreground">{t('upsell.month')}</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15">
                      <Check className="h-3 w-3 text-primary" />
                    </div>
                    <span className="font-medium">
                      {t('upsell.smsIncluded', { count: PLAN_DETAILS.ultra.smsIncluded })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                      <Sparkles className="h-3 w-3 text-primary/70" />
                    </div>
                    <span>{t('upsell.topupPrice', { price: PLAN_DETAILS.ultra.topupPrice })}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* CTA */}
            <Button className="w-full shadow-sm shadow-primary/20" render={<Link href="/dashboard/subscription" />}>
                {t('upsell.upgradeToPro')}
                <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {t('description', {
              price: priceEuros.toFixed(2).replace('.', ','),
              plan: planSlug.charAt(0).toUpperCase() + planSlug.slice(1),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Upsell banner for Pro users */}
          {isPro && showUpsell && (
            <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/8 to-primary/5 p-3.5">
              <button
                onClick={() => setShowUpsell(false)}
                className="absolute right-2.5 top-2.5 rounded-full p-1 text-muted-foreground/50 transition-colors hover:bg-primary/10 hover:text-primary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-start gap-3 pr-6">
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium text-primary">{t('upsell.didYouKnow')}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t('upsell.ultraBenefit', {
                      price: PLAN_DETAILS.ultra.topupPrice,
                      count: PLAN_DETAILS.ultra.smsIncluded,
                    })}
                  </p>
                  <Button variant="outline" className="h-7 border-primary/20 text-xs hover:bg-primary/5 hover:text-primary" render={<Link href="/dashboard/subscription" />}>
                      {t('upsell.upgradeToUltra')}
                      <ArrowRight className="ml-1.5 h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Package selection */}
          <div className="grid grid-cols-2 gap-3">
            {SMS_TOPUP_PACKAGES.map((pkg) => {
              const totalCents = pkg * priceCents
              const isSelected = selectedPackage === pkg
              const isPopular = pkg === 100

              return (
                <button
                  key={pkg}
                  onClick={() => setSelectedPackage(pkg)}
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-xl border p-4 transition-all',
                    isSelected
                      ? 'border-primary bg-gradient-to-br from-primary/5 to-primary/10 shadow-sm shadow-primary/10'
                      : 'border-border bg-card hover:border-primary/30 hover:shadow-sm'
                  )}
                >
                  {isPopular && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
                      {t('popular')}
                    </span>
                  )}
                  {isSelected && (
                    <div className="absolute right-2 top-2">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                  <span className={cn('text-2xl font-bold', isSelected && 'text-primary')}>{pkg}</span>
                  <span className="text-xs text-muted-foreground">SMS</span>
                  <span className={cn('mt-2 font-semibold', isSelected && 'text-primary')}>
                    {formatPrice(totalCents)}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Info message */}
          <div className="flex items-start gap-2.5 rounded-xl border border-primary/10 bg-primary/5 p-3">
            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-3 w-3 text-primary" />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('info')}</p>
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={loading}
            >
              {t('cancel')}
            </Button>
            <Button onClick={handlePurchase} disabled={loading} className="flex-1 shadow-sm shadow-primary/20">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('processing')}
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  {t('pay', { amount: formatPrice(selectedPackage * priceCents) })}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
