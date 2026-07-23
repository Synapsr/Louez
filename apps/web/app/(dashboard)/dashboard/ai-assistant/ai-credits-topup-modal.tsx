'use client'

import { useState } from 'react'

import { motion } from 'framer-motion'
import {
  BadgePercent,
  Check,
  CreditCard,
  Loader2,
  MessagesSquare,
  Phone,
  PhoneCall,
  ShieldCheck,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Badge,
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
  /** Where Stripe returns after checkout (defaults to the AI assistant page). */
  returnPath?: string
  /** Flat voice tariff (credits/min) — powers the "minutes of calls" line. */
  voiceCreditsPerMinute?: number | null
  /** Monthly number rental in credits — powers the "months of number" line. */
  numberRentalCredits?: number | null
}

/**
 * Recharge dialog: packs on the left, and on the right a live "what you get"
 * panel for the selected pack — concrete equivalences (advisor conversations,
 * voice minutes, months of number rental) plus the per-credit price and the
 * savings vs the smallest pack, so bigger packs sell themselves on facts.
 */
export function AiCreditsTopupModal({
  open,
  onOpenChange,
  packages,
  returnPath,
  voiceCreditsPerMinute,
  numberRentalCredits,
}: AiCreditsTopupModalProps) {
  const t = useTranslations('dashboard.aiCredits.topup')
  const locale = useLocale()
  // Default to the middle pack (a mild "recommended" nudge).
  const popularIndex =
    packages.length > 0 ? Math.floor((packages.length - 1) / 2) : 0
  const [selectedIndex, setSelectedIndex] = useState(popularIndex)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = packages[selectedIndex]

  // Credit packs are charged in EUR end-to-end (checkout, auto-top-up).
  const formatPrice = (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
    }).format(cents / 100)

  const formatUnitPrice = (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(cents / 100)

  // Degressivity is measured against the least favorable pack (highest price
  // per credit), so every other pack shows an honest "-X%".
  const worstUnitCents = Math.max(
    ...packages.map((p) => p.priceCents / p.credits),
  )
  const savingsFor = (pkg: AiCreditPackage) => {
    const unit = pkg.priceCents / pkg.credits
    const percent = Math.round((1 - unit / worstUnitCents) * 100)
    return percent >= 1 ? percent : null
  }

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

  // Alternatives, not a bundle: each tile shows how far the pack goes if spent
  // entirely on that usage, with its exchange rate as the fine print.
  const valueRows = selected
    ? [
        {
          icon: MessagesSquare,
          headline: t('valueConversations', { count: selected.credits }),
          rate: t('rateConversations'),
        },
        voiceCreditsPerMinute
          ? {
              icon: PhoneCall,
              headline: t('valueMinutes', {
                count: Math.floor(selected.credits / voiceCreditsPerMinute),
              }),
              rate: t('rateMinutes', { credits: voiceCreditsPerMinute }),
            }
          : null,
        numberRentalCredits
          ? {
              icon: Phone,
              headline: t('valueNumberMonths', {
                count: Math.floor(selected.credits / numberRentalCredits),
              }),
              rate: t('rateNumber', { credits: numberRentalCredits }),
            }
          : null,
      ].filter(
        (row): row is { icon: typeof Phone; headline: string; rate: string } =>
          Boolean(row),
      )
    : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div className="bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg">
              <CreditCard className="text-primary h-5 w-5" />
            </div>
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="grid gap-4 pt-2 sm:grid-cols-[1fr_240px]">
            {/* Packs */}
            <div className="space-y-2">
              {packages.map((pkg, index) => {
                const isSelected = index === selectedIndex
                const savings = savingsFor(pkg)
                return (
                  <button
                    key={`${pkg.credits}-${pkg.priceCents}`}
                    type="button"
                    onClick={() => setSelectedIndex(index)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-[transform,border-color,background-color,box-shadow] duration-150 ease-out active:scale-[0.98]',
                      isSelected
                        ? 'border-primary from-primary/5 to-primary/10 shadow-primary/10 bg-gradient-to-br shadow-sm'
                        : 'border-border bg-card hover:border-primary/30 hover:shadow-sm',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                          isSelected
                            ? 'border-primary bg-primary'
                            : 'border-muted-foreground/30',
                        )}
                      >
                        {isSelected && (
                          <Check className="text-primary-foreground h-3 w-3" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'text-lg font-bold leading-tight tabular-nums',
                              isSelected && 'text-primary',
                            )}
                          >
                            {pkg.credits}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {t('credits')}
                          </span>
                          {index === popularIndex && (
                            <Badge variant="info" className="text-[10px]">
                              {t('popular')}
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {t('perCredit', {
                            amount: formatUnitPrice(
                              pkg.priceCents / pkg.credits,
                            ),
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          'font-semibold tabular-nums',
                          isSelected && 'text-primary',
                        )}
                      >
                        {formatPrice(pkg.priceCents)}
                      </p>
                      {savings !== null && (
                        <p className="text-primary flex items-center justify-end gap-0.5 text-xs font-medium tabular-nums">
                          <BadgePercent className="h-3 w-3" />
                          {t('savings', { percent: savings })}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* What the selected pack represents. The "or" separators make it
                unambiguous these are ALTERNATIVE ways to spend the same
                credits, each with its exchange rate as fine print. Keyed on the
                selection so a pack change softly fades the numbers in. */}
            <div className="bg-muted/40 flex flex-col rounded-xl border p-4">
              <p className="text-sm font-semibold">{t('valueTitle')}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('valueIntro')}
              </p>
              <motion.div
                key={selectedIndex}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="mt-3 space-y-1.5"
              >
                {valueRows.map((row, index) => (
                  <div key={row.rate}>
                    {index > 0 && (
                      <div className="flex items-center gap-2 pb-1.5">
                        <div className="bg-border h-px flex-1" />
                        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                          {t('valueOr')}
                        </span>
                        <div className="bg-border h-px flex-1" />
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="bg-primary/10 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
                        <row.icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-tight tabular-nums">
                          {row.headline}
                        </p>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {row.rate}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </motion.div>
              <div className="text-muted-foreground mt-auto flex items-start gap-2 border-t pt-3 text-xs">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('noExpiry')}
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 mt-4 rounded-lg p-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
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
              className="shadow-primary/20 flex-1 shadow-sm transition-transform duration-150 ease-out active:scale-[0.96]"
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
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}
