'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { AlertTriangle, ArrowRight } from 'lucide-react'
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

const limitTypeLabels: Record<StorePlanLimit['limitType'], keyof PlanLimitsAlertProps['translations']> = {
  products: 'products',
  reservations: 'reservationsPerMonth',
  customers: 'customers',
}

function setCurrentStoreCookie(storeId: string) {
  document.cookie = `currentStoreId=${storeId}; path=/; max-age=31536000`
}

export function PlanLimitsAlert({ limits, translations }: PlanLimitsAlertProps) {
  const router = useRouter()

  if (limits.length === 0) {
    return null
  }

  const handleUpgradeClick = (storeId: string) => {
    setCurrentStoreCookie(storeId)
    router.push('/dashboard/subscription')
    router.refresh()
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900/50">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <h4 className="font-medium text-amber-800 dark:text-amber-200">
                {translations.title}
              </h4>
              <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                {translations.description.replace('{count}', String(limits.length))}
              </p>
            </div>

            <div className="space-y-3">
              {limits.map((limit, index) => (
                <div
                  key={`${limit.storeId}-${limit.limitType}-${index}`}
                  className="flex items-center gap-3 rounded-lg bg-white/60 p-3 dark:bg-black/20"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm truncate">
                        {limit.storeName}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {limit.current}/{limit.limit} {translations[limitTypeLabels[limit.limitType]]}
                      </span>
                    </div>
                    <Progress
                      value={limit.percentUsed}
                      className="h-2"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUpgradeClick(limit.storeId)}
                    className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/50"
                  >
                    {translations.upgrade}
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
