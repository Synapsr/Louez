'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn, formatCurrency } from '@/lib/utils'
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ExternalLink,
  Crown,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'
import type { StorePerformance } from '@/lib/dashboard/multi-store-metrics'
import { setCurrentStoreAction } from '../actions'

interface StoresTableProps {
  stores: StorePerformance[]
  translations: {
    title: string
    store: string
    plan: string
    revenue: string
    change: string
    reservations: string
    pending: string
    customers: string
    goToStore: string
  }
  limitsMap?: Record<string, boolean>
}

function PlanBadge({ planSlug, planName }: { planSlug: string; planName: string }) {
  const planConfig: Record<string, { className: string; icon: React.ReactNode }> = {
    start: {
      className: 'bg-muted text-muted-foreground',
      icon: null,
    },
    pro: {
      className: 'bg-primary/10 text-primary',
      icon: <Sparkles className="h-3 w-3" />,
    },
    ultra: {
      className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      icon: <Crown className="h-3 w-3" />,
    },
  }

  const config = planConfig[planSlug] || planConfig.start

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        config.className
      )}
    >
      {config.icon}
      {planName}
    </span>
  )
}

function ChangeIndicator({ change }: { change: number }) {
  const isPositive = change > 0
  const isNegative = change < 0
  const isNeutral = change === 0

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 text-xs font-medium',
        isPositive && 'text-emerald-600 dark:text-emerald-400',
        isNegative && 'text-red-600 dark:text-red-400',
        isNeutral && 'text-muted-foreground'
      )}
    >
      {isPositive && <ArrowUpRight className="h-3 w-3" />}
      {isNegative && <ArrowDownRight className="h-3 w-3" />}
      {isNeutral && <Minus className="h-3 w-3" />}
      <span>{isNeutral ? '0' : `${isPositive ? '+' : ''}${change.toFixed(1)}`}%</span>
    </div>
  )
}

export function StoresTable({ stores, translations, limitsMap = {} }: StoresTableProps) {
  const router = useRouter()

  const handleStoreClick = async (storeId: string) => {
    await setCurrentStoreAction(storeId)
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{translations.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-muted-foreground">
                <th className="pb-3 font-medium">{translations.store}</th>
                <th className="pb-3 font-medium">{translations.plan}</th>
                <th className="pb-3 font-medium text-right">{translations.revenue}</th>
                <th className="pb-3 font-medium text-right hidden sm:table-cell">{translations.reservations}</th>
                <th className="pb-3 font-medium text-right hidden md:table-cell">{translations.customers}</th>
                <th className="pb-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stores.map((store) => (
                <tr
                  key={store.storeId}
                  className="group transition-colors hover:bg-accent/50"
                >
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9 ring-2 ring-border">
                        <AvatarImage src={store.logoUrl || undefined} alt={store.storeName} />
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                          {store.storeName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{store.storeName}</span>
                        {limitsMap[store.storeId] && (
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <PlanBadge planSlug={store.planSlug} planName={store.planName} />
                  </td>
                  <td className="py-4 text-right">
                    <div className="space-y-1">
                      <span className="font-medium">{formatCurrency(store.revenue)}</span>
                      <div className="flex justify-end">
                        <ChangeIndicator change={store.revenueChange} />
                      </div>
                    </div>
                  </td>
                  <td className="py-4 text-right hidden sm:table-cell">
                    <div className="space-y-0.5">
                      <span className="font-medium">{store.reservations}</span>
                      {store.pendingReservations > 0 && (
                        <p className="text-xs text-muted-foreground">
                          ({store.pendingReservations} {translations.pending})
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="py-4 text-right hidden md:table-cell">
                    <span className="font-medium">{store.customers}</span>
                  </td>
                  <td className="py-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStoreClick(store.storeId)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {translations.goToStore}
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
