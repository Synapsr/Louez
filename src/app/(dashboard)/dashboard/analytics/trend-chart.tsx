'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'

export interface TrendDataPoint {
  date: string
  label: string
  visitors: number
  pageViews: number
  conversions: number
}

interface TrendChartProps {
  data: TrendDataPoint[]
  showConversions?: boolean
}

export function TrendChart({ data, showConversions = true }: TrendChartProps) {
  const t = useTranslations('dashboard.analytics')

  if (data.length === 0 || data.every((d) => d.visitors === 0 && d.pageViews === 0)) {
    return (
      <div className="flex h-[350px] flex-col items-center justify-center text-muted-foreground">
        <TrendingUp className="mb-2 h-8 w-8" />
        <p>{t('noData')}</p>
      </div>
    )
  }

  return (
    <div className="h-[350px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorVisitors" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorConversions" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            dx={-10}
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="rounded-lg border bg-background p-3 shadow-lg">
                    <p className="mb-2 font-medium">{label}</p>
                    {payload.map((entry) => (
                      <p
                        key={entry.dataKey}
                        className="text-sm"
                        style={{ color: entry.color }}
                      >
                        {entry.name}: {entry.value?.toLocaleString()}
                      </p>
                    ))}
                  </div>
                )
              }
              return null
            }}
          />
          <Legend
            verticalAlign="top"
            height={36}
            iconType="circle"
            formatter={(value) => (
              <span className="text-sm text-muted-foreground">{value}</span>
            )}
          />
          <Area
            type="monotone"
            dataKey="visitors"
            name={t('visitors')}
            stroke="var(--primary)"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorVisitors)"
          />
          {showConversions && (
            <Area
              type="monotone"
              dataKey="conversions"
              name={t('conversions')}
              stroke="#22c55e"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorConversions)"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
