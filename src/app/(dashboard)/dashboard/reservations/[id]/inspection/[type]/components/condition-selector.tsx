'use client'

import { useTranslations } from 'next-intl'
import { Check, AlertTriangle, X, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConditionRating } from '@/types/inspection'

interface ConditionSelectorProps {
  value: ConditionRating
  onChange: (value: ConditionRating) => void
  disabled?: boolean
  compact?: boolean
}

const CONDITIONS: {
  value: ConditionRating
  icon: React.ElementType
  colorClass: string
  bgClass: string
  ringClass: string
}[] = [
  {
    value: 'excellent',
    icon: Sparkles,
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/50',
    ringClass: 'ring-emerald-500',
  },
  {
    value: 'good',
    icon: Check,
    colorClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-50 dark:bg-blue-950/50',
    ringClass: 'ring-blue-500',
  },
  {
    value: 'fair',
    icon: AlertTriangle,
    colorClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-950/50',
    ringClass: 'ring-amber-500',
  },
  {
    value: 'damaged',
    icon: X,
    colorClass: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-50 dark:bg-red-950/50',
    ringClass: 'ring-red-500',
  },
]

export function ConditionSelector({
  value,
  onChange,
  disabled = false,
  compact = false,
}: ConditionSelectorProps) {
  const t = useTranslations('dashboard.settings.inspection')

  return (
    <div
      className={cn(
        'grid gap-2',
        compact ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'
      )}
      role="radiogroup"
      aria-label={t('wizard.condition')}
    >
      {CONDITIONS.map((condition) => {
        const Icon = condition.icon
        const isSelected = value === condition.value

        return (
          <button
            key={condition.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(condition.value)}
            className={cn(
              'relative flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 p-3 transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              compact ? 'p-2' : 'p-3 sm:p-4',
              isSelected
                ? cn(
                    'border-transparent shadow-sm',
                    condition.bgClass,
                    condition.ringClass,
                    'ring-2'
                  )
                : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full transition-transform',
                compact ? 'h-6 w-6' : 'h-8 w-8 sm:h-10 sm:w-10',
                isSelected ? condition.bgClass : 'bg-muted',
                isSelected && 'scale-110'
              )}
            >
              <Icon
                className={cn(
                  'transition-colors',
                  compact ? 'h-3.5 w-3.5' : 'h-4 w-4 sm:h-5 sm:w-5',
                  isSelected ? condition.colorClass : 'text-muted-foreground'
                )}
              />
            </div>
            <span
              className={cn(
                'text-center font-medium transition-colors',
                compact ? 'text-[10px]' : 'text-xs sm:text-sm',
                isSelected ? condition.colorClass : 'text-muted-foreground'
              )}
            >
              {t(`conditions.${condition.value}`)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A simpler 3-state version for quick inspections
 * Maps to: OK (excellent/good) | Usure (fair) | Dommage (damaged)
 */
interface QuickConditionSelectorProps {
  value: 'ok' | 'wear' | 'damage'
  onChange: (value: 'ok' | 'wear' | 'damage') => void
  disabled?: boolean
}

const QUICK_CONDITIONS = [
  {
    value: 'ok' as const,
    icon: Check,
    labelKey: 'conditions.ok',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/50',
    borderClass: 'border-emerald-500',
  },
  {
    value: 'wear' as const,
    icon: AlertTriangle,
    labelKey: 'conditions.wear',
    colorClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-950/50',
    borderClass: 'border-amber-500',
  },
  {
    value: 'damage' as const,
    icon: X,
    labelKey: 'conditions.damage',
    colorClass: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-50 dark:bg-red-950/50',
    borderClass: 'border-red-500',
  },
]

export function QuickConditionSelector({
  value,
  onChange,
  disabled = false,
}: QuickConditionSelectorProps) {
  const t = useTranslations('dashboard.settings.inspection')

  return (
    <div
      className="grid grid-cols-3 gap-3"
      role="radiogroup"
      aria-label={t('wizard.condition')}
    >
      {QUICK_CONDITIONS.map((condition) => {
        const Icon = condition.icon
        const isSelected = value === condition.value

        return (
          <button
            key={condition.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(condition.value)}
            className={cn(
              'relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              'active:scale-95',
              isSelected
                ? cn('shadow-md', condition.bgClass, condition.borderClass)
                : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full transition-all',
                isSelected
                  ? cn(condition.bgClass, 'scale-110')
                  : 'bg-muted'
              )}
            >
              <Icon
                className={cn(
                  'h-6 w-6 transition-colors',
                  isSelected ? condition.colorClass : 'text-muted-foreground'
                )}
              />
            </div>
            <span
              className={cn(
                'text-sm font-semibold transition-colors',
                isSelected ? condition.colorClass : 'text-muted-foreground'
              )}
            >
              {t(condition.labelKey)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Convert quick condition to full condition rating
 */
export function quickToFullCondition(quick: 'ok' | 'wear' | 'damage'): ConditionRating {
  switch (quick) {
    case 'ok':
      return 'good'
    case 'wear':
      return 'fair'
    case 'damage':
      return 'damaged'
  }
}

/**
 * Convert full condition to quick condition
 */
export function fullToQuickCondition(full: ConditionRating): 'ok' | 'wear' | 'damage' {
  switch (full) {
    case 'excellent':
    case 'good':
      return 'ok'
    case 'fair':
      return 'wear'
    case 'damaged':
      return 'damage'
  }
}
