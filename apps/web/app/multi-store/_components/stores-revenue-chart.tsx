'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { NameType, ValueType, Payload } from 'recharts/types/component/DefaultTooltipContent'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { TrendingUp, Eye, EyeOff } from 'lucide-react'
import { cn, formatCurrency, getCurrencySymbol } from '@louez/utils'
import type { StoreRevenueTrend } from '@/lib/dashboard/multi-store-metrics'

function useThemeColors() {
  const [colors, setColors] = useState({
    mutedForeground: '#71717a',
    border: '#e4e4e7',
    muted: '#f4f4f5',
  })

  useEffect(() => {
    const updateColors = () => {
      const isDark = document.documentElement.classList.contains('dark')
      setColors({
        mutedForeground: isDark ? '#a1a1aa' : '#71717a',
        border: isDark ? '#27272a' : '#e4e4e7',
        muted: isDark ? '#27272a' : '#f4f4f5',
      })
    }

    updateColors()

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          updateColors()
        }
      })
    })

    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [])

  return colors
}

interface StoresRevenueChartProps {
  data: StoreRevenueTrend[]
  storeNames: string[]
  translations: {
    title: string
    description: string
  }
  emptyMessage?: string
}

const CHART_COLORS = [
  { stroke: '#3b82f6', fill: '#3b82f680' }, // blue-500
  { stroke: '#10b981', fill: '#10b98180' }, // emerald-500
  { stroke: '#f59e0b', fill: '#f59e0b80' }, // amber-500
  { stroke: '#ef4444', fill: '#ef444480' }, // red-500
  { stroke: '#8b5cf6', fill: '#8b5cf680' }, // violet-500
  { stroke: '#ec4899', fill: '#ec489980' }, // pink-500
  { stroke: '#06b6d4', fill: '#06b6d480' }, // cyan-500
  { stroke: '#84cc16', fill: '#84cc1680' }, // lime-500
]

interface StoreLegendItemProps {
  name: string
  color: string
  isVisible: boolean
  totalRevenue: number
  onToggle: () => void
}

function StoreLegendItem({
  name,
  color,
  isVisible,
  totalRevenue,
  onToggle,
}: StoreLegendItemProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all',
        isVisible
          ? 'border-transparent bg-accent/50 hover:bg-accent'
          : 'border-dashed border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/50'
      )}
    >
      <span
        className={cn(
          'h-3 w-3 rounded-full transition-opacity',
          !isVisible && 'opacity-30'
        )}
        style={{ backgroundColor: color }}
      />
      <span className="flex flex-col items-start gap-0.5">
        <span className={cn('truncate max-w-[100px]', !isVisible && 'line-through')}>
          {name}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatCurrency(totalRevenue)}
        </span>
      </span>
      {isVisible ? (
        <Eye className="h-3.5 w-3.5 text-muted-foreground ml-1" />
      ) : (
        <EyeOff className="h-3.5 w-3.5 ml-1" />
      )}
    </button>
  )
}

export function StoresRevenueChart({
  data,
  storeNames,
  translations,
  emptyMessage = 'No data available',
}: StoresRevenueChartProps) {
  // Filter stores with at least some revenue during the period
  const storesWithRevenue = useMemo(() => {
    return storeNames.filter((name) =>
      data.some((d) => (d[name] as number) > 0)
    )
  }, [storeNames, data])

  const [visibleStores, setVisibleStores] = useState<Set<string>>(
    () => new Set(storesWithRevenue)
  )
  const themeColors = useThemeColors()

  // Update visible stores when storesWithRevenue changes
  useEffect(() => {
    setVisibleStores(new Set(storesWithRevenue))
  }, [storesWithRevenue])

  const currencySymbol = getCurrencySymbol('EUR')
  const hasData = storesWithRevenue.length > 0

  const visibleStoreNames = useMemo(
    () => storesWithRevenue.filter((name) => visibleStores.has(name)),
    [storesWithRevenue, visibleStores]
  )

  // Calculate total revenue for each store
  const storeTotals = useMemo(() => {
    return storesWithRevenue.reduce(
      (acc, name) => {
        acc[name] = data.reduce((sum, d) => sum + ((d[name] as number) || 0), 0)
        return acc
      },
      {} as Record<string, number>
    )
  }, [storesWithRevenue, data])

  const toggleStore = (name: string) => {
    setVisibleStores((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        if (next.size > 1) {
          next.delete(name)
        }
      } else {
        next.add(name)
      }
      return next
    })
  }

  const getColor = (index: number) => CHART_COLORS[index % CHART_COLORS.length]

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
      <CardContent className="space-y-4">
        {/* Interactive Legend */}
        <div className="flex flex-wrap gap-2">
          {storesWithRevenue.map((name) => {
            const originalIndex = storeNames.indexOf(name)
            return (
              <StoreLegendItem
                key={name}
                name={name}
                color={getColor(originalIndex).stroke}
                isVisible={visibleStores.has(name)}
                totalRevenue={storeTotals[name]}
                onToggle={() => toggleStore(name)}
              />
            )
          })}
        </div>

        {/* Chart */}
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
                {visibleStoreNames.map((name) => {
                  const originalIndex = storeNames.indexOf(name)
                  const colors = getColor(originalIndex)
                  return (
                    <linearGradient
                      key={name}
                      id={`gradient-${name.replace(/\s+/g, '-')}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={colors.stroke} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={colors.stroke} stopOpacity={0.05} />
                    </linearGradient>
                  )
                })}
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={themeColors.border}
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: themeColors.mutedForeground }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: themeColors.mutedForeground }}
                tickLine={false}
                axisLine={false}
                width={60}
                tickFormatter={(value: number) =>
                  value >= 1000
                    ? `${(value / 1000).toFixed(0)}k${currencySymbol}`
                    : `${value}${currencySymbol}`
                }
              />
              <Tooltip
                content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                  if (active && payload && payload.length) {
                    const total = payload.reduce(
                      (sum: number, entry: Payload<ValueType, NameType>) => sum + ((entry.value as number) || 0),
                      0
                    )
                    return (
                      <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-3 shadow-lg">
                        <p className="font-semibold text-sm mb-2">{label}</p>
                        <div className="space-y-1.5">
                          {payload.map((entry: Payload<ValueType, NameType>, index: number) => (
                            <div
                              key={index}
                              className="flex items-center justify-between gap-4 text-sm"
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: entry.stroke }}
                                />
                                <span className="text-muted-foreground">
                                  {entry.name}
                                </span>
                              </span>
                              <span className="font-medium tabular-nums">
                                {formatCurrency(entry.value as number)}
                              </span>
                            </div>
                          ))}
                          {payload.length > 1 && (
                            <>
                              <div className="border-t my-1.5" />
                              <div className="flex items-center justify-between gap-4 text-sm font-medium">
                                <span>Total</span>
                                <span className="tabular-nums">
                                  {formatCurrency(total)}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  }
                  return null
                }}
              />
              {visibleStoreNames.map((name) => {
                const originalIndex = storeNames.indexOf(name)
                const colors = getColor(originalIndex)
                return (
                  <Area
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={colors.stroke}
                    strokeWidth={2}
                    fill={`url(#gradient-${name.replace(/\s+/g, '-')})`}
                    dot={false}
                    activeDot={{
                      r: 4,
                      strokeWidth: 2,
                      stroke: colors.stroke,
                      fill: 'var(--background)',
                    }}
                  />
                )
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
