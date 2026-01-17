'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Rocket,
  Sparkles,
  TrendingUp,
  Package,
  CalendarCheck,
  Users,
  Crown,
  ArrowRight,
  Check,
  Zap,
  MessageSquare,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type LimitType = 'products' | 'reservations' | 'customers' | 'sms'

interface UpgradeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  limitType: LimitType
  currentCount: number
  limit: number
  currentPlan?: string
  suggestedPlan?: string
}

const LIMIT_ICONS = {
  products: Package,
  reservations: CalendarCheck,
  customers: Users,
  sms: MessageSquare,
}

export function UpgradeModal({
  open,
  onOpenChange,
  limitType,
  currentCount,
  limit,
  currentPlan = 'start',
  suggestedPlan = 'pro',
}: UpgradeModalProps) {
  const router = useRouter()
  const t = useTranslations('upgradeModal')
  const [isNavigating, setIsNavigating] = useState(false)

  const Icon = LIMIT_ICONS[limitType]
  const isOverLimit = currentCount > limit

  const handleUpgrade = () => {
    setIsNavigating(true)
    router.push('/dashboard/subscription')
  }

  // Get the plan to suggest based on current plan
  const targetPlan = currentPlan === 'start' ? 'pro' : 'ultra'
  const targetPlanName = targetPlan === 'pro' ? 'Pro' : 'Ultra'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md overflow-hidden p-0">
        {/* Gradient header */}
        <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 pt-8 pb-6">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />

          <div className="relative">
            {/* Icon with glow */}
            <div className="flex justify-center mb-4">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl scale-150" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary shadow-lg">
                  {isOverLimit ? (
                    <TrendingUp className="h-8 w-8 text-primary-foreground" />
                  ) : (
                    <Icon className="h-8 w-8 text-primary-foreground" />
                  )}
                </div>
              </div>
            </div>

            <DialogHeader className="space-y-3">
              <DialogTitle className="text-center text-xl">
                {isOverLimit
                  ? t(`${limitType}.overLimitTitle`)
                  : t(`${limitType}.limitReachedTitle`)
                }
              </DialogTitle>
              <DialogDescription className="text-center text-base">
                {isOverLimit
                  ? t(`${limitType}.overLimitDescription`, { count: currentCount, limit })
                  : t(`${limitType}.limitReachedDescription`, { count: currentCount, limit })
                }
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {/* Success message */}
          {isOverLimit && (
            <div className="mb-6 rounded-lg bg-green-500/5 border border-green-500/20 p-4">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10 flex-shrink-0">
                  <Sparkles className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-green-700 dark:text-green-400">
                    {t(`${limitType}.successMessage`)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t(`${limitType}.successSubtext`)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Upgrade CTA card */}
          <div className="rounded-lg border bg-card p-4 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <Badge className="bg-primary text-primary-foreground border-0 gap-1">
                <Crown className="h-3 w-3" />
                {targetPlanName}
              </Badge>
              <Badge variant="outline" className="bg-green-500/5 text-green-600 border-green-500/20">
                {t('earlyBird')}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              {t(`${limitType}.upgradeDescription`, { plan: targetPlanName })}
            </p>

            {/* Key benefits */}
            <ul className="space-y-2 mb-4">
              {[
                t(`${limitType}.benefit1`, { plan: targetPlanName }),
                t(`${limitType}.benefit2`),
                t(`${limitType}.benefit3`),
              ].map((benefit, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-primary flex-shrink-0" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleUpgrade}
              disabled={isNavigating}
              className="w-full gap-2"
              size="lg"
            >
              {isNavigating ? (
                t('loading')
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  {t('upgradeNow')}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="w-full text-muted-foreground"
            >
              {t('maybeLater')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Blur Overlay Component (for items over limit)
// ============================================================================

interface BlurOverlayProps {
  limitType: LimitType
  currentPlan?: string
  onUpgradeClick: () => void
  className?: string
}

export function BlurOverlay({
  limitType,
  currentPlan = 'start',
  onUpgradeClick,
  className,
}: BlurOverlayProps) {
  const t = useTranslations('upgradeModal')
  const Icon = LIMIT_ICONS[limitType]
  const targetPlan = currentPlan === 'start' ? 'Pro' : 'Ultra'

  return (
    <div className={cn(
      "absolute inset-0 z-10 flex items-center justify-center",
      "bg-gradient-to-t from-background via-background/95 to-background/80",
      "backdrop-blur-[2px]",
      className
    )}>
      <div className="text-center px-4 py-6 max-w-sm">
        <div className="flex justify-center mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        </div>
        <h3 className="font-semibold text-lg mb-2">
          {t(`${limitType}.blurTitle`)}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          {t(`${limitType}.blurDescription`, { plan: targetPlan })}
        </p>
        <Button onClick={onUpgradeClick} className="gap-2">
          <Zap className="h-4 w-4" />
          {t('unlock', { plan: targetPlan })}
        </Button>
      </div>
    </div>
  )
}

// ============================================================================
// Limit Banner Component (for top of pages)
// ============================================================================

interface LimitBannerProps {
  limitType: LimitType
  current: number
  limit: number
  currentPlan?: string
  onUpgradeClick: () => void
  className?: string
}

export function LimitBanner({
  limitType,
  current,
  limit,
  currentPlan = 'start',
  onUpgradeClick,
  className,
}: LimitBannerProps) {
  const t = useTranslations('upgradeModal')
  const percentUsed = Math.min(100, Math.round((current / limit) * 100))
  const isNearLimit = percentUsed >= 80
  const isAtLimit = current >= limit

  if (percentUsed < 80) return null

  return (
    <div className={cn(
      "rounded-lg border p-4",
      isAtLimit
        ? "bg-amber-500/5 border-amber-500/20"
        : "bg-primary/5 border-primary/20",
      className
    )}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full flex-shrink-0",
            isAtLimit ? "bg-amber-500/10" : "bg-primary/10"
          )}>
            <TrendingUp className={cn(
              "h-5 w-5",
              isAtLimit ? "text-amber-600" : "text-primary"
            )} />
          </div>
          <div>
            <p className="font-medium">
              {isAtLimit
                ? t(`${limitType}.bannerAtLimit`)
                : t(`${limitType}.bannerNearLimit`)
              }
            </p>
            <p className="text-sm text-muted-foreground">
              {t('usage', { current, limit, percent: percentUsed })}
            </p>
          </div>
        </div>
        <Button
          onClick={onUpgradeClick}
          variant={isAtLimit ? "default" : "outline"}
          size="sm"
          className="flex-shrink-0 gap-1"
        >
          <Zap className="h-3.5 w-3.5" />
          {t('upgrade')}
        </Button>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isAtLimit ? "bg-amber-500" : "bg-primary"
          )}
          style={{ width: `${percentUsed}%` }}
        />
      </div>
    </div>
  )
}
