'use client'

import Link from 'next/link'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@louez/utils'

interface DashboardAlertProps {
  pendingCount: number
  className?: string
}

export function DashboardAlert({ pendingCount, className }: DashboardAlertProps) {
  const t = useTranslations('dashboard.home')

  if (pendingCount === 0) {
    return null
  }

  return (
    <Link
      href="/dashboard/reservations?status=pending"
      className={cn(
        'group flex items-center justify-between rounded-xl border border-orange-200 bg-orange-50 p-4 transition-all hover:border-orange-300 hover:bg-orange-100 dark:border-orange-900/50 dark:bg-orange-950/30 dark:hover:border-orange-800 dark:hover:bg-orange-950/50',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/50">
          <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <p className="font-medium text-orange-900 dark:text-orange-100">
            {pendingCount === 1
              ? t('alert.singlePending')
              : t('alert.multiplePending', { count: pendingCount })}
          </p>
          <p className="text-sm text-orange-700 dark:text-orange-300">
            {t('alert.description')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm font-medium text-orange-700 dark:text-orange-300">
        <span className="hidden sm:inline">{t('alert.action')}</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  )
}
