'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { formatCurrency, getCurrencySymbol } from '@/lib/utils'

interface RevenueData {
  month: string
  revenue: number
  reservations: number
}

interface RevenueChartProps {
  data: RevenueData[]
  currency?: string
}

export function RevenueChart({ data, currency = 'EUR' }: RevenueChartProps) {
  const t = useTranslations('dashboard.statistics')
  const currencySymbol = getCurrencySymbol(currency)

  if (data.every((d) => d.revenue === 0)) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center text-muted-foreground">
        <TrendingUp className="mb-2 h-8 w-8" />
        <p>{t('noRevenueData')}</p>
      </div>
    )
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{
            top: 10,
            right: 10,
            left: 0,
            bottom: 0,
          }}
        >
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            className="text-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${(value / 1000).toFixed(0)}k${currencySymbol}`}
            className="text-muted-foreground"
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="rounded-lg border bg-background p-3 shadow-md">
                    <p className="font-medium">{label}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('revenueAbbrev')}: {formatCurrency(payload[0].value as number, currency)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('reservationsCount', { count: payload[0].payload.reservations })}
                    </p>
                  </div>
                )
              }
              return null
            }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorRevenue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
