'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  Check,
  Package,
  Calendar,
  Star,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Sparkles,
  X,
  Rocket,
} from 'lucide-react'
import { cn } from '@louez/utils'

// Types defined inline to avoid server-only module import
interface StoreMetrics {
  activeProductCount: number
  totalReservations: number
  completedReservations: number
}

interface SetupChecklistProps {
  metrics: StoreMetrics
  storeSlug: string
  className?: string
}

interface ChecklistItem {
  key: string
  icon: React.ElementType
  completed: boolean
  href?: string
  action?: string
}

// Circular progress component
function CircularProgress({
  progress,
  size = 48,
  strokeWidth = 4,
}: {
  progress: number
  size?: number
  strokeWidth?: number
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (progress / 100) * circumference

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Background circle */}
      <svg className="absolute inset-0 -rotate-90" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/50"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-primary transition-all duration-500"
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold text-primary">{progress}%</span>
      </div>
    </div>
  )
}

export function SetupChecklist({
  metrics,
  storeSlug,
}: SetupChecklistProps) {
  const t = useTranslations('dashboard.home')
  const [isExpanded, setIsExpanded] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)

  // Check if dismissed in this session
  useEffect(() => {
    const dismissed = sessionStorage.getItem('setup-checklist-dismissed')
    if (dismissed === 'true') {
      setIsDismissed(true)
    }
  }, [])

  const handleDismiss = () => {
    setIsDismissed(true)
    sessionStorage.setItem('setup-checklist-dismissed', 'true')
  }

  const items: ChecklistItem[] = [
    {
      key: 'createAccount',
      icon: Check,
      completed: true,
    },
    {
      key: 'configureStore',
      icon: Check,
      completed: true,
    },
    {
      key: 'addFirstProduct',
      icon: Package,
      completed: metrics.activeProductCount > 0,
      href: '/dashboard/products/new',
      action: 'setup.addFirstProduct',
    },
    {
      key: 'firstReservation',
      icon: Calendar,
      completed: metrics.totalReservations > 0,
      href: '/dashboard/reservations/new',
      action: 'setup.createReservation',
    },
    {
      key: 'firstCompleted',
      icon: Star,
      completed: metrics.completedReservations > 0,
    },
  ]

  const completedCount = items.filter((item) => item.completed).length
  const progress = Math.round((completedCount / items.length) * 100)
  const allCompleted = completedCount === items.length

  // Find the next uncompleted step
  const nextStep = items.find((item) => !item.completed)

  // Don't render if all completed or dismissed
  if (allCompleted || isDismissed) {
    return null
  }

  return (
    <div className="setup-widget-container">
      <div
        className={cn(
          'setup-widget',
          isExpanded && 'setup-widget--expanded'
        )}
      >
        {/* Header - Always visible */}
        <div className="setup-widget-header">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex flex-1 items-center gap-3"
          >
            <CircularProgress progress={progress} size={44} strokeWidth={3} />
            <div className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">
                  {t('setup.title')}
                </span>
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <p className="text-xs text-muted-foreground">
                {completedCount}/{items.length} {t('setup.stepsCompleted')}
              </p>
            </div>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-muted/80">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>
          <button
            onClick={handleDismiss}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            title={t('setup.dismissForNow')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="setup-widget-content">
            {/* Checklist items */}
            <ul className="space-y-1">
              {items.map((item, index) => (
                <li
                  key={item.key}
                  className={cn(
                    'setup-widget-item',
                    item.completed && 'setup-widget-item--completed',
                    !item.completed && nextStep?.key === item.key && 'setup-widget-item--current'
                  )}
                >
                  <div
                    className={cn(
                      'setup-widget-item-icon',
                      item.completed && 'setup-widget-item-icon--completed'
                    )}
                  >
                    {item.completed ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-[10px] font-bold">{index + 1}</span>
                    )}
                  </div>
                  <span
                    className={cn(
                      'flex-1 text-sm',
                      item.completed && 'text-muted-foreground line-through'
                    )}
                  >
                    {t(`setup.steps.${item.key}`)}
                  </span>
                </li>
              ))}
            </ul>

            {/* Next step CTA */}
            {nextStep && nextStep.href && (
              <Link
                href={nextStep.href}
                className="setup-widget-cta"
              >
                <Rocket className="h-4 w-4" />
                <span>{t(nextStep.action || 'setup.start')}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        )}

        {/* Collapsed: Quick CTA */}
        {!isExpanded && nextStep && nextStep.href && (
          <Link
            href={nextStep.href}
            className="setup-widget-quick-cta"
          >
            <span className="truncate text-xs">
              {t(`setup.steps.${nextStep.key}`)}
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </Link>
        )}
      </div>
    </div>
  )
}
