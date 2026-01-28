'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp } from 'lucide-react'
import { formatCurrency, getCurrencySymbol } from '@/lib/utils'
import type { StoreRevenueTrend } from '@/lib/dashboard/multi-store-metrics'

interface StoresRevenueChartProps {
  data: StoreRevenueTrend[]
  storeNames: string[]
  translations: {
    title: string
    description: string
  }
  emptyMessage?: string
}

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2, 173 58% 39%))',
  'hsl(var(--chart-3, 197 37% 24%))',
  'hsl(var(--chart-4, 43 74% 66%))',
  'hsl(var(--chart-5, 27 87% 67%))',
  'hsl(220 70% 50%)',
]

export function StoresRevenueChart({
  data,
  storeNames,
  translations,
  emptyMessage = 'No data available',
}: StoresRevenueChartProps) {
  const currencySymbol = getCurrencySymbol('EUR')
  const hasData = data.some((d) =>
    storeNames.some((name) => (d[name] as number) > 0)
  )

  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{translations.title}</CardTitle>
          <CardDescription>{translations.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] flex-col items-center justify-center text-muted-foreground">
            <TrendingUp className="mb-2 h-8 w-8" />
            <p>{emptyMessage}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{translations.title}</CardTitle>
        <CardDescription>{translations.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{
                top: 10,
                right: 10,
                left: 0,
                bottom: 0,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  value >= 1000
                    ? `${(value / 1000).toFixed(0)}k${currencySymbol}`
                    : `${value}${currencySymbol}`
                }
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="rounded-lg border bg-background p-3 shadow-md">
                        <p className="font-medium mb-2">{label}</p>
                        {payload.map((entry, index) => (
                          <p
                            key={index}
                            className="text-sm"
                            style={{ color: entry.color }}
                          >
                            {entry.name}: {formatCurrency(entry.value as number)}
                          </p>
                        ))}
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: '12px' }}
              />
              {storeNames.map((name, index) => (
                <Bar
                  key={name}
                  dataKey={name}
                  fill={COLORS[index % COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
