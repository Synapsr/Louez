'use client'

import { useTranslations } from 'next-intl'
import { Calendar, LayoutList } from 'lucide-react'
import { cn } from '@louez/utils'

// =============================================================================
// Types
// =============================================================================

export type CalendarViewMode = 'calendar' | 'products'

interface ViewModeToggleProps {
  value: CalendarViewMode
  onChange: (mode: CalendarViewMode) => void
  className?: string
}

// =============================================================================
// Component
// =============================================================================

/**
 * ViewModeToggle - A segmented control to switch between Calendar and Products view
 *
 * Designed to be placed centrally in the controls bar for high visibility.
 */
export function ViewModeToggle({ value, onChange, className }: ViewModeToggleProps) {
  const t = useTranslations('dashboard.calendar')

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg bg-muted p-1',
        className
      )}
      role="tablist"
      aria-label={t('viewMode.label')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === 'calendar'}
        onClick={() => onChange('calendar')}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          value === 'calendar'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Calendar className="h-4 w-4" />
        <span className="hidden sm:inline">{t('viewMode.calendar')}</span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={value === 'products'}
        onClick={() => onChange('products')}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          value === 'products'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <LayoutList className="h-4 w-4" />
        <span className="hidden sm:inline">{t('viewMode.products')}</span>
      </button>
    </div>
  )
}
