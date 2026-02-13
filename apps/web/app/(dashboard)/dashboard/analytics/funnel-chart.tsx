'use client'

import { cn } from '@louez/utils'

export interface FunnelStep {
  label: string
  value: number
  color?: string
}

interface FunnelChartProps {
  steps: FunnelStep[]
  className?: string
}

export function FunnelChart({ steps, className }: FunnelChartProps) {
  if (steps.length === 0) return null

  const maxValue = steps[0]?.value || 1

  // Default colors for funnel steps (progressively darker)
  const defaultColors = [
    'bg-primary/90',
    'bg-primary/70',
    'bg-primary/50',
    'bg-primary/30',
  ]

  return (
    <div className={cn('space-y-3', className)}>
      {steps.map((step, index) => {
        const percentage = maxValue > 0 ? (step.value / maxValue) * 100 : 0
        const conversionRate = index === 0
          ? 100
          : steps[index - 1]?.value > 0
            ? (step.value / steps[index - 1].value) * 100
            : 0

        return (
          <div key={step.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{step.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">
                  {step.value.toLocaleString()}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {percentage.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="relative h-8 w-full overflow-hidden rounded-md bg-muted">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-md transition-all duration-500',
                  step.color || defaultColors[index] || 'bg-primary/30'
                )}
                style={{ width: `${percentage}%` }}
              />
              {index > 0 && conversionRate < 100 && (
                <div className="absolute inset-y-0 right-2 flex items-center">
                  <span className="text-xs text-muted-foreground">
                    {conversionRate.toFixed(0)}% →
                  </span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
