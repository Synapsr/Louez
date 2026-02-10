'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@louez/ui'
import { Progress } from '@louez/ui'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@louez/ui'
import { AlertTriangle, ArrowRight, ChevronDown, X } from 'lucide-react'
import { cn } from '@louez/utils'
import type { StorePlanLimit } from '@/lib/dashboard/multi-store-metrics'

interface PlanLimitsAlertProps {
  limits: StorePlanLimit[]
  translations: {
    title: string
    description: string
    products: string
    reservationsPerMonth: string
    customers: string
    upgrade: string
  }
}

const limitTypeLabels: Record<
  StorePlanLimit['limitType'],
  keyof PlanLimitsAlertProps['translations']
> = {
  products: 'products',
  reservations: 'reservationsPerMonth',
  customers: 'customers',
}

function setCurrentStoreCookie(storeId: string) {
  document.cookie = `currentStoreId=${storeId}; path=/; max-age=31536000`
}

function getProgressColor(percent: number): string {
  if (percent >= 100) return 'bg-red-500'
  if (percent >= 90) return 'bg-amber-500'
  return 'bg-amber-400'
}

function getDisplayPercent(percent: number): number {
  return Math.min(percent, 100)
}

export function PlanLimitsAlert({ limits, translations }: PlanLimitsAlertProps) {
  const router = useRouter()
  const [isDismissed, setIsDismissed] = useState(false)
  const [isOpen, setIsOpen] = useState(true)

  if (limits.length === 0 || isDismissed) {
    return null
  }

  const handleUpgradeClick = (storeId: string) => {
    setCurrentStoreCookie(storeId)
    router.push('/dashboard/subscription')
    router.refresh()
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/50 dark:border-amber-900/50 dark:from-amber-950/30 dark:to-orange-950/20">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
              <AlertTriangle className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h4 className="font-semibold text-amber-900 dark:text-amber-100">
                {translations.title}
              </h4>
              <p className="text-sm text-amber-700/80 dark:text-amber-300/70">
                {translations.description.replace('{count}', String(limits.length))}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <CollapsibleTrigger render={<Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-amber-700 hover:bg-amber-200/50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-800/30"
              />}>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform duration-200',
                    isOpen && 'rotate-180'
                  )}
                />
                <span className="sr-only">Toggle</span>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsDismissed(true)}
              className="h-8 w-8 text-amber-700 hover:bg-amber-200/50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-800/30"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Dismiss</span>
            </Button>
          </div>
        </div>

        {/* Content */}
        <CollapsibleContent>
          <div className="border-t border-amber-200/60 px-4 pb-4 pt-3 dark:border-amber-800/40">
            <div className="space-y-2.5">
              {limits.map((limit, index) => (
                <div
                  key={`${limit.storeId}-${limit.limitType}-${index}`}
                  className="flex items-center gap-4 rounded-lg bg-white/70 p-3 shadow-sm dark:bg-black/20"
                >
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate text-foreground">
                        {limit.storeName}
                      </span>
                      <span
                        className={cn(
                          'text-xs font-medium whitespace-nowrap',
                          limit.percentUsed >= 100
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-muted-foreground'
                        )}
                      >
                        {limit.current}/{limit.limit}{' '}
                        {translations[limitTypeLabels[limit.limitType]]}
                      </span>
                    </div>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-amber-100 dark:bg-amber-900/30">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          getProgressColor(limit.percentUsed)
                        )}
                        style={{ width: `${getDisplayPercent(limit.percentUsed)}%` }}
                      />
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleUpgradeClick(limit.storeId)}
                    className="shrink-0 border-amber-300 bg-white text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
                  >
                    {translations.upgrade}
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
