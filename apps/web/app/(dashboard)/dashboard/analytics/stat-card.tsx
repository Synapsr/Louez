'use client'

import { Card, CardContent } from '@louez/ui'
import { cn } from '@louez/utils'
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Users,
  Eye,
  ShoppingCart,
  TrendingUp,
  Euro,
  Calendar,
  Package,
  BarChart3,
} from 'lucide-react'

type IconName = 'users' | 'eye' | 'shopping-cart' | 'trending-up' | 'euro' | 'calendar' | 'package' | 'bar-chart'

const iconMap = {
  users: Users,
  eye: Eye,
  'shopping-cart': ShoppingCart,
  'trending-up': TrendingUp,
  euro: Euro,
  calendar: Calendar,
  package: Package,
  'bar-chart': BarChart3,
}

interface StatCardProps {
  title: string
  value: string | number
  change?: number
  changeLabel?: string
  icon?: IconName
  iconColor?: 'default' | 'green' | 'blue' | 'orange' | 'purple'
  format?: 'number' | 'currency' | 'percent'
}

const iconColors = {
  default: 'text-muted-foreground',
  green: 'text-emerald-500',
  blue: 'text-blue-500',
  orange: 'text-orange-500',
  purple: 'text-purple-500',
}

export function StatCard({
  title,
  value,
  change,
  changeLabel,
  icon,
  iconColor = 'default',
}: StatCardProps) {
  const Icon = icon ? iconMap[icon] : null
  const isPositive = change !== undefined && change > 0
  const isNegative = change !== undefined && change < 0
  const isNeutral = change === undefined || change === 0

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
          </div>
          {Icon && (
            <div className={cn('rounded-lg bg-muted p-2', iconColors[iconColor])}>
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>

        {change !== undefined && (
          <div className="mt-3 flex items-center gap-1.5">
            <div
              className={cn(
                'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
                isPositive && 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
                isNegative && 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
                isNeutral && 'bg-muted text-muted-foreground'
              )}
            >
              {isPositive && <ArrowUpRight className="h-3 w-3" />}
              {isNegative && <ArrowDownRight className="h-3 w-3" />}
              {isNeutral && <Minus className="h-3 w-3" />}
              <span>{isNeutral ? '0' : `${isPositive ? '+' : ''}${change.toFixed(1)}`}%</span>
            </div>
            {changeLabel && (
              <span className="text-xs text-muted-foreground">{changeLabel}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
