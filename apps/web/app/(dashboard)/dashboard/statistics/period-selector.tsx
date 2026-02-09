'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'

const PERIODS = ['week', 'month', 'quarter', 'semester', 'year'] as const
type Period = (typeof PERIODS)[number]

export function PeriodSelector() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('dashboard.statistics')

  const currentPeriod = (searchParams.get('period') as Period) || 'semester'

  const handlePeriodChange = (value: string | null) => {
    if (value === null) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('period', value)
    router.push(`/dashboard/statistics?${params.toString()}`)
  }

  return (
    <Select value={currentPeriod} onValueChange={handlePeriodChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={t('period')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="week">{t('periods.week')}</SelectItem>
        <SelectItem value="month">{t('periods.month')}</SelectItem>
        <SelectItem value="quarter">{t('periods.quarter')}</SelectItem>
        <SelectItem value="semester">{t('periods.semester')}</SelectItem>
        <SelectItem value="year">{t('periods.year')}</SelectItem>
      </SelectContent>
    </Select>
  )
}
