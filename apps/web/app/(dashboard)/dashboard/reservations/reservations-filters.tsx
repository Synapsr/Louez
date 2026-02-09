'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { Badge } from '@louez/ui'

interface ReservationCounts {
  all: number
  pending: number
  confirmed: number
  ongoing: number
  completed: number
}

interface ReservationsFiltersProps {
  counts: ReservationCounts
  currentStatus?: string
  currentPeriod?: string
}

const STATUS_KEYS = ['all', 'pending', 'confirmed', 'ongoing', 'completed'] as const
const PERIOD_KEYS = ['all', 'today', 'thisWeek', 'thisMonth'] as const

export function ReservationsFilters({
  counts,
  currentStatus = 'all',
  currentPeriod = 'all',
}: ReservationsFiltersProps) {
  const t = useTranslations('dashboard.reservations')
  const router = useRouter()
  const searchParams = useSearchParams()

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === 'all') {
        params.delete(name)
      } else {
        params.set(name, value)
      }
      return params.toString()
    },
    [searchParams]
  )

  const handleStatusChange = (value: string) => {
    router.push(`/dashboard/reservations?${createQueryString('status', value)}`)
  }

  const handlePeriodChange = (value: string | null) => {
    if (value === null) return
    router.push(`/dashboard/reservations?${createQueryString('period', value)}`)
  }

  const getCount = (status: string): number => {
    if (status === 'all') return counts.all
    return counts[status as keyof Omit<ReservationCounts, 'all'>] || 0
  }

  const getStatusLabel = (key: string): string => {
    if (key === 'all') return t('filters.all')
    return t(`status.${key}`)
  }

  const getPeriodLabel = (key: string): string => {
    if (key === 'all') return t('allPeriods')
    return t(`filters.${key}`)
  }

  // Map period keys to URL values
  const periodUrlMap: Record<string, string> = {
    all: 'all',
    today: 'today',
    thisWeek: 'week',
    thisMonth: 'month',
  }

  // Map URL values back to keys for display
  const urlToPeriodMap: Record<string, string> = {
    all: 'all',
    today: 'today',
    week: 'thisWeek',
    month: 'thisMonth',
  }

  const currentPeriodKey = urlToPeriodMap[currentPeriod] || 'all'

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Status Tabs */}
      <div className="flex items-center gap-1 rounded-lg border bg-muted/50 p-1">
        {STATUS_KEYS.map((key) => {
          const count = getCount(key)
          const isActive = currentStatus === key

          return (
            <Button
              key={key}
              variant={isActive ? 'secondary' : 'ghost'}
              className="gap-2"
              onClick={() => handleStatusChange(key)}
            >
              {getStatusLabel(key)}
              {key === 'pending' && count > 0 ? (
                <Badge
                  variant="default"
                  className="ml-1 h-5 min-w-5 px-1.5 bg-orange-500"
                >
                  {count}
                </Badge>
              ) : (
                <Badge
                  variant={isActive ? 'default' : 'secondary'}
                  className="ml-1 h-5 min-w-5 px-1.5"
                >
                  {count}
                </Badge>
              )}
            </Button>
          )
        })}
      </div>

      {/* Period Filter */}
      <Select value={currentPeriod} onValueChange={handlePeriodChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={t('period')} />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_KEYS.map((key) => (
            <SelectItem key={key} value={periodUrlMap[key]}>
              {getPeriodLabel(key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
