'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bot, CreditCard, Wallet } from 'lucide-react'

import { Badge, Button } from '@louez/ui'
import { cn } from '@louez/utils'

import type { AiCreditPackage } from '@/lib/plans'
import { AiCreditsTopupModal } from './ai-credits-topup-modal'

/** Anywhere on the page can request the recharge modal (e.g. the voice setup's
 * insufficient-credits nudge) by dispatching this window event — the modal
 * itself lives here, next to the balance it refills. */
export const OPEN_TOPUP_EVENT = 'ai-assistant:open-topup'

interface AiAssistantHeaderProps {
  /** null = credit layer disabled (self-host): no chip, no recharge. */
  credits: {
    /** Total available (monthly remaining + prepaid), null = unlimited. */
    totalCredits: number | null
    low: boolean
  } | null
  packages: AiCreditPackage[]
  voiceCreditsPerMinute: number | null
  numberRentalCredits: number | null
}

/**
 * Sticky page header: identity on the left, the credit balance + recharge
 * always within reach on the right — the page's single "wallet" anchor.
 */
export const AiAssistantHeader = ({
  credits,
  packages,
  voiceCreditsPerMinute,
  numberRentalCredits,
}: AiAssistantHeaderProps) => {
  const t = useTranslations('dashboard.aiAssistant.header')
  const searchParams = useSearchParams()
  const [topupOpen, setTopupOpen] = useState(false)

  const canTopup = credits !== null && packages.length > 0

  // Open the recharge modal from a deep link (?recharge=1 — used by the
  // renewal emails) or from anywhere on the page via the window event.
  useEffect(() => {
    if (!canTopup) return
    if (searchParams.get('recharge') === '1') setTopupOpen(true)
    const open = () => setTopupOpen(true)
    window.addEventListener(OPEN_TOPUP_EVENT, open)
    return () => window.removeEventListener(OPEN_TOPUP_EVENT, open)
  }, [canTopup, searchParams])

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b bg-background/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:-mx-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight">
              {t('title')}
            </h1>
            <p className="text-muted-foreground hidden truncate text-xs sm:block">
              {t('subtitle')}
            </p>
          </div>
        </div>

        {credits && (
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant={credits.low ? 'warning' : 'secondary'}
              className={cn('gap-1.5 py-1.5 pl-2 pr-2.5 text-sm font-medium')}
            >
              <Wallet className="h-3.5 w-3.5" />
              {credits.totalCredits === null
                ? t('creditsUnlimited')
                : t('credits', {
                    count: Math.floor(credits.totalCredits),
                  })}
            </Badge>
            {canTopup && (
              <Button size="sm" className="gap-1.5" onClick={() => setTopupOpen(true)}>
                <CreditCard className="h-3.5 w-3.5" />
                {t('recharge')}
              </Button>
            )}
          </div>
        )}
      </div>

      {canTopup && (
        <AiCreditsTopupModal
          open={topupOpen}
          onOpenChange={setTopupOpen}
          packages={packages}
          returnPath="/dashboard/ai-assistant"
          voiceCreditsPerMinute={voiceCreditsPerMinute}
          numberRentalCredits={numberRentalCredits}
        />
      )}
    </div>
  )
}
