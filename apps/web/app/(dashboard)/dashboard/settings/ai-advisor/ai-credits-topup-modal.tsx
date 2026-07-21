'use client'

import { useState } from 'react'

import { Check, CreditCard, Loader2, Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Button,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@louez/ui'
import { cn } from '@louez/utils'

import type { AiCreditPackage } from '@/lib/plans'

import { createAiCreditTopupCheckout } from './credit-actions'

type AiCreditsTopupModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  packages: AiCreditPackage[]
  /** Where Stripe returns after checkout (defaults to the AI advisor page). */
  returnPath?: string
}

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + '€'
}

export function AiCreditsTopupModal({
  open,
  onOpenChange,
  packages,
  returnPath,
}: AiCreditsTopupModalProps) {
  const t = useTranslations('dashboard.aiCredits.topup')
  const locale = useLocale()
  // Default to the middle pack (a mild "recommended" nudge).
  const [selectedIndex, setSelectedIndex] = useState(
    packages.length > 0 ? Math.floor((packages.length - 1) / 2) : 0,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = packages[selectedIndex]

  const handlePurchase = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await createAiCreditTopupCheckout(
        selectedIndex,
        locale,
        returnPath,
      )
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="space-y-4 pt-2">
            <div
              className={cn(
                'grid gap-3',
                packages.length >= 3 ? 'grid-cols-3' : 'grid-cols-2',
              )}
            >
              {packages.map((pkg, index) => {
                const isSelected = index === selectedIndex
                return (
                  <button
                    key={`${pkg.credits}-${pkg.priceCents}`}
                    type="button"
                    onClick={() => setSelectedIndex(index)}
                    className={cn(
                      'relative flex flex-col items-center justify-center rounded-xl border p-4 transition-all',
                      isSelected
                        ? 'border-primary bg-gradient-to-br from-primary/5 to-primary/10 shadow-sm shadow-primary/10'
                        : 'border-border bg-card hover:border-primary/30 hover:shadow-sm',
                    )}
                  >
                    {isSelected && (
                      <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                    <span
                      className={cn(
                        'text-2xl font-bold',
                        isSelected && 'text-primary',
                      )}
                    >
                      {pkg.credits}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('credits')}
                    </span>
                    <span
                      className={cn(
                        'mt-2 font-semibold',
                        isSelected && 'text-primary',
                      )}
                    >
                      {formatPrice(pkg.priceCents)}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-primary/10 bg-primary/5 p-3">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('info')}
              </p>
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1"
                disabled={loading}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                onClick={handlePurchase}
                disabled={loading || !selected}
                className="flex-1 shadow-sm shadow-primary/20"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('processing')}
                  </>
                ) : (
                  <>
                    <CreditCard className="mr-2 h-4 w-4" />
                    {selected
                      ? t('pay', { amount: formatPrice(selected.priceCents) })
                      : t('pay', { amount: '—' })}
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}
