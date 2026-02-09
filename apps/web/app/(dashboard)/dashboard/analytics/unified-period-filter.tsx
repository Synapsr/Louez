'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { RefreshCw } from 'lucide-react'
import { cn } from '@louez/utils'

export type Period = '7d' | '30d' | '90d' | '6m' | '12m'

interface UnifiedPeriodFilterProps {
  className?: string
}

export function UnifiedPeriodFilter({ className }: UnifiedPeriodFilterProps) {
  const t = useTranslations('dashboard.analytics')
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentPeriod = (searchParams.get('period') as Period) || '30d'

  const periods: { value: Period; label: string }[] = [
    { value: '7d', label: t('period.7d') },
    { value: '30d', label: t('period.30d') },
    { value: '90d', label: t('period.90d') },
    { value: '6m', label: t('period.6m') },
    { value: '12m', label: t('period.12m') },
  ]

  const handlePeriodChange = (value: Period) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('period', value)
    router.push(`/dashboard/analytics?${params.toString()}`)
  }

  const handleRefresh = () => {
    router.refresh()
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Quick period buttons (desktop) */}
      <div className="hidden items-center gap-1 md:flex">
        {periods.map((period) => (
          <Button
            key={period.value}
            variant={currentPeriod === period.value ? 'default' : 'ghost'}
            onClick={() => handlePeriodChange(period.value)}
            className="h-8 px-3"
          >
            {period.label}
          </Button>
        ))}
      </div>

      {/* Select (mobile) */}
      <div className="md:hidden">
        <Select value={currentPeriod} onValueChange={(v) => { if (v !== null) handlePeriodChange(v as Period) }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((period) => (
              <SelectItem key={period.value} value={period.value}>
                {period.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Refresh button */}
      <Button variant="outline" size="icon" onClick={handleRefresh} className="h-8 w-8">
        <RefreshCw className="h-4 w-4" />
        <span className="sr-only">{t('refresh')}</span>
      </Button>
    </div>
  )
}
