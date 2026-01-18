'use client'

import { Smartphone, Monitor, Tablet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export interface DeviceStats {
  mobile: number
  tablet: number
  desktop: number
}

interface DeviceBreakdownProps {
  data: DeviceStats
  className?: string
}

export function DeviceBreakdown({ data, className }: DeviceBreakdownProps) {
  const t = useTranslations('dashboard.analytics')
  const total = data.mobile + data.tablet + data.desktop

  if (total === 0) {
    return (
      <div className={cn('flex items-center justify-center py-8 text-muted-foreground', className)}>
        <p>{t('noData')}</p>
      </div>
    )
  }

  const devices = [
    {
      key: 'mobile',
      label: t('mobile'),
      value: data.mobile,
      percentage: ((data.mobile / total) * 100).toFixed(0),
      icon: Smartphone,
      color: 'bg-blue-500',
    },
    {
      key: 'desktop',
      label: t('desktop'),
      value: data.desktop,
      percentage: ((data.desktop / total) * 100).toFixed(0),
      icon: Monitor,
      color: 'bg-emerald-500',
    },
    {
      key: 'tablet',
      label: t('tablet'),
      value: data.tablet,
      percentage: ((data.tablet / total) * 100).toFixed(0),
      icon: Tablet,
      color: 'bg-orange-500',
    },
  ].sort((a, b) => b.value - a.value)

  return (
    <div className={cn('space-y-4', className)}>
      {/* Progress bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {devices.map((device) => (
          <div
            key={device.key}
            className={cn('h-full transition-all duration-500', device.color)}
            style={{ width: `${device.percentage}%` }}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="space-y-2">
        {devices.map((device) => (
          <div key={device.key} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn('h-3 w-3 rounded-full', device.color)} />
              <device.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{device.label}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium tabular-nums">{device.value.toLocaleString()}</span>
              <span className="text-muted-foreground tabular-nums">({device.percentage}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
