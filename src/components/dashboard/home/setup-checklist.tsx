'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Check, Package, Calendar, Star, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

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
}

export function SetupChecklist({
  metrics,
  storeSlug,
  className,
}: SetupChecklistProps) {
  const t = useTranslations('dashboard.home')

  const items: ChecklistItem[] = [
    {
      key: 'createAccount',
      icon: Check,
      completed: true, // Always done if viewing dashboard
    },
    {
      key: 'configureStore',
      icon: Check,
      completed: true, // Always done after onboarding
    },
    {
      key: 'addFirstProduct',
      icon: Package,
      completed: metrics.activeProductCount > 0,
      href: '/dashboard/products/new',
    },
    {
      key: 'firstReservation',
      icon: Calendar,
      completed: metrics.totalReservations > 0,
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

  if (allCompleted) {
    return null
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{t('setup.title')}</CardTitle>
            <CardDescription>{t('setup.description')}</CardDescription>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold text-primary">{progress}%</span>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {items.map((item) => (
            <li
              key={item.key}
              className={cn(
                'flex items-center gap-3 px-6 py-4 transition-colors',
                item.completed
                  ? 'bg-muted/20'
                  : 'bg-background hover:bg-muted/10'
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  item.completed
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {item.completed ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <item.icon className="h-4 w-4" />
                )}
              </div>
              <span
                className={cn(
                  'flex-1 text-sm',
                  item.completed
                    ? 'text-muted-foreground line-through'
                    : 'font-medium'
                )}
              >
                {t(`setup.steps.${item.key}`)}
              </span>
              {!item.completed && item.href && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={item.href}>
                    {t('setup.start')}
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>

        {/* CTA section */}
        {nextStep && (
          <div className="border-t bg-muted/20 px-6 py-4">
            {metrics.activeProductCount === 0 ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {t('setup.addProductHint')}
                </p>
                <Button asChild>
                  <Link href="/dashboard/products/new">
                    <Package className="mr-2 h-4 w-4" />
                    {t('setup.addFirstProduct')}
                  </Link>
                </Button>
              </div>
            ) : metrics.totalReservations === 0 ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {t('setup.shareHint')}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" asChild>
                    <a
                      href={`https://${storeSlug}.${process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('setup.viewStore')}
                    </a>
                  </Button>
                  <Button asChild>
                    <Link href="/dashboard/reservations/new">
                      <Calendar className="mr-2 h-4 w-4" />
                      {t('setup.createReservation')}
                    </Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
