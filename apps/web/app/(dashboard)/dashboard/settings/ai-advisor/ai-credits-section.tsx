'use client'

import { useState } from 'react'

import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Switch,
} from '@louez/ui'
import { cn } from '@louez/utils'

import type { AiCreditPackage } from '@/lib/plans'

import { updateAiCreditsAutoTopup } from './credit-actions'
import { AiCreditsTopupModal } from './ai-credits-topup-modal'

export type AiCreditsHistoryRow = {
  id: string
  type: 'grant' | 'topup' | 'auto_topup' | 'adjustment'
  credits: number
  amountCents: number
  currency: string
  status: 'pending' | 'completed' | 'failed'
  createdAt: string | Date
}

export type AiCreditsSectionProps = {
  monthlyIncludedCredits: number | null
  monthlyRemainingCredits: number | null
  prepaidCredits: number
  autoTopup: { enabled: boolean; thresholdCredits: number; packIndex: number }
  packages: AiCreditPackage[]
  history: AiCreditsHistoryRow[]
  topupStatus: 'success' | 'cancelled' | null
  /** Balance + recharge only, hiding auto-recharge and history (billing page). */
  compact?: boolean
  /** Where Stripe returns after checkout (defaults to the AI advisor page). */
  returnPath?: string
}

const LOW_BALANCE_CREDITS = 5

function fmtCredits(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}
function fmtPrice(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + '€'
}

export function AiCreditsSection({
  monthlyIncludedCredits,
  monthlyRemainingCredits,
  prepaidCredits,
  autoTopup,
  packages,
  history,
  topupStatus,
  compact = false,
  returnPath,
}: AiCreditsSectionProps) {
  const t = useTranslations('dashboard.aiCredits')
  const [modalOpen, setModalOpen] = useState(false)

  const [autoEnabled, setAutoEnabled] = useState(autoTopup.enabled)
  const [autoThreshold, setAutoThreshold] = useState(
    String(autoTopup.thresholdCredits || ''),
  )
  const [autoPackIndex, setAutoPackIndex] = useState(
    autoTopup.packIndex >= 0 ? autoTopup.packIndex : packages.length ? 0 : -1,
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const isUnlimited = monthlyIncludedCredits === null
  const hasMonthlyAllowance =
    monthlyIncludedCredits !== null && monthlyIncludedCredits > 0
  const totalAvailable = isUnlimited
    ? null
    : (monthlyRemainingCredits ?? 0) + prepaidCredits
  const isLow =
    totalAvailable !== null && totalAvailable < LOW_BALANCE_CREDITS
  const canTopup = packages.length > 0

  const handleSaveAutoTopup = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await updateAiCreditsAutoTopup({
        enabled: autoEnabled,
        thresholdCredits: Number(autoThreshold) || 0,
        packIndex: autoPackIndex,
      })
      if (res.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Wallet className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        {isLow && (
          <Badge variant="warning" className="shrink-0">
            {t('lowBalance')}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-5">
        {topupStatus === 'success' && (
          <div className="flex items-center gap-2 rounded-lg border border-success/32 bg-success/4 px-3 py-2.5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {t('topupSuccess')}
          </div>
        )}
        {topupStatus === 'cancelled' && (
          <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            {t('topupCancelled')}
          </div>
        )}

        {/* Balance */}
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border bg-muted/30 p-4">
          <div className="min-w-0">
            <p className="text-3xl font-bold text-foreground">
              {isUnlimited ? t('unlimited') : fmtCredits(totalAvailable ?? 0)}
              {!isUnlimited && (
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {t('creditsUnit')}
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isUnlimited
                ? t('breakdownUnlimited', {
                    prepaid: fmtCredits(prepaidCredits),
                  })
                : hasMonthlyAllowance
                  ? t('breakdown', {
                      monthly: fmtCredits(monthlyRemainingCredits ?? 0),
                      prepaid: fmtCredits(prepaidCredits),
                    })
                  : t('breakdownPrepaidOnly', {
                      prepaid: fmtCredits(prepaidCredits),
                    })}
            </p>
            {!isUnlimited && (
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                {t('conversationsHint', {
                  count: Math.floor(totalAvailable ?? 0),
                })}
              </p>
            )}
          </div>
          {canTopup && (
            <Button type="button" onClick={() => setModalOpen(true)}>
              <CreditCard className="mr-2 h-4 w-4" />
              {t('recharge')}
            </Button>
          )}
        </div>

        {isLow && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/32 bg-warning/4 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('lowBalanceHint')}
            </p>
          </div>
        )}

        {/* Auto-recharge */}
        {!compact && canTopup && (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {t('autoTopup.title')}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('autoTopup.description')}
                </p>
              </div>
              <Switch
                checked={autoEnabled}
                onCheckedChange={(checked) => setAutoEnabled(Boolean(checked))}
              />
            </div>

            {autoEnabled && (
              <div className="space-y-3 border-t pt-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('autoTopup.thresholdLabel')}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={autoThreshold}
                    onChange={(e) => setAutoThreshold(e.target.value)}
                    className="max-w-[10rem]"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('autoTopup.packLabel')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {packages.map((pkg, index) => (
                      <button
                        key={`${pkg.credits}-${pkg.priceCents}`}
                        type="button"
                        onClick={() => setAutoPackIndex(index)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                          index === autoPackIndex
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/30',
                        )}
                      >
                        {t('autoTopup.pack', {
                          credits: pkg.credits,
                          amount: fmtPrice(pkg.priceCents),
                        })}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground/70">
                  {t('autoTopup.cardNote')}
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveAutoTopup}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                {t('autoTopup.save')}
              </Button>
              {saved && (
                <span className="text-xs text-success">{t('autoTopup.saved')}</span>
              )}
            </div>
          </div>
        )}

        {/* History */}
        {!compact && history.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t('history.title')}
            </p>
            <div className="divide-y rounded-xl border">
              {history.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {t(`history.type.${row.type}`)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-foreground">
                      +{fmtCredits(row.credits)} {t('creditsUnit')}
                    </p>
                    {row.amountCents > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {fmtPrice(row.amountCents)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {canTopup && (
        <AiCreditsTopupModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          packages={packages}
          returnPath={returnPath}
        />
      )}
    </Card>
  )
}
