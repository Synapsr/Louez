'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useTranslations } from 'next-intl'
import {
  Clock,
  CheckCircle,
  XCircle,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  CreditCard,
  User,
  Ban,
  Plus,
  Globe,
  UserPlus,
  ShieldCheck,
  ShieldX,
  Banknote,
  Wifi,
  Hourglass,
  AlertCircle,
  Link,
  Pencil,
  ChevronDown,
  ClipboardCheck,
  ClipboardX,
  PenLine,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

type ActivityType =
  | 'created'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'picked_up'
  | 'returned'
  | 'note_updated'
  | 'payment_added'
  | 'payment_updated'
  | 'payment_received'
  | 'payment_initiated'
  | 'payment_failed'
  | 'payment_expired'
  | 'deposit_authorized'
  | 'deposit_captured'
  | 'deposit_released'
  | 'deposit_failed'
  | 'access_link_sent'
  | 'modified'
  // Inspection events
  | 'inspection_departure_started'
  | 'inspection_departure_completed'
  | 'inspection_return_started'
  | 'inspection_return_completed'
  | 'inspection_damage_detected'
  | 'inspection_signed'

interface Activity {
  id: string
  activityType: ActivityType
  description: string | null
  metadata: Record<string, unknown> | null
  createdAt: Date
  user: {
    id: string
    name: string | null
    email: string
    image: string | null
  } | null
}

interface ActivityTimelineV2Props {
  activities: Activity[]
  reservationCreatedAt: Date
  reservationSource: string | null
  initialVisibleCount?: number
}

const ACTIVITY_CONFIG: Record<
  ActivityType,
  {
    icon: typeof Clock
    bgColor: string
    iconColor: string
  }
> = {
  created: {
    icon: Plus,
    bgColor: 'bg-primary/10',
    iconColor: 'text-primary',
  },
  confirmed: {
    icon: CheckCircle,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  rejected: {
    icon: XCircle,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  cancelled: {
    icon: Ban,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  picked_up: {
    icon: ArrowUpRight,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  returned: {
    icon: ArrowDownRight,
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  note_updated: {
    icon: FileText,
    bgColor: 'bg-gray-100 dark:bg-gray-900/50',
    iconColor: 'text-gray-600 dark:text-gray-400',
  },
  payment_added: {
    icon: CreditCard,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  payment_updated: {
    icon: CreditCard,
    bgColor: 'bg-amber-100 dark:bg-amber-950/50',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  payment_received: {
    icon: Wifi,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  payment_initiated: {
    icon: Hourglass,
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  payment_failed: {
    icon: AlertCircle,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  payment_expired: {
    icon: Clock,
    bgColor: 'bg-gray-100 dark:bg-gray-900/50',
    iconColor: 'text-gray-600 dark:text-gray-400',
  },
  deposit_authorized: {
    icon: ShieldCheck,
    bgColor: 'bg-amber-100 dark:bg-amber-950/50',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  deposit_captured: {
    icon: Banknote,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  deposit_released: {
    icon: ShieldCheck,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  deposit_failed: {
    icon: ShieldX,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  access_link_sent: {
    icon: Link,
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  modified: {
    icon: Pencil,
    bgColor: 'bg-amber-100 dark:bg-amber-950/50',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  // Inspection events
  inspection_departure_started: {
    icon: ClipboardCheck,
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  inspection_departure_completed: {
    icon: ClipboardCheck,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  inspection_return_started: {
    icon: ClipboardCheck,
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  inspection_return_completed: {
    icon: ClipboardCheck,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  inspection_damage_detected: {
    icon: ClipboardX,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  inspection_signed: {
    icon: PenLine,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
}

function getUserInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }
  return email[0].toUpperCase()
}

export function ActivityTimelineV2({
  activities,
  reservationCreatedAt,
  reservationSource,
  initialVisibleCount = 3,
}: ActivityTimelineV2Props) {
  const t = useTranslations('dashboard.reservations')
  const [isExpanded, setIsExpanded] = useState(false)

  // Sort activities by date (most recent first)
  const sortedActivities = [...activities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  // Find the creation activity to get source info
  const createdActivity = activities.find((a) => a.activityType === 'created')
  const isManualCreation =
    reservationSource === 'manual' || createdActivity?.metadata?.source === 'manual'

  const visibleActivities = isExpanded
    ? sortedActivities
    : sortedActivities.slice(0, initialVisibleCount)
  const hasMoreActivities = sortedActivities.length > initialVisibleCount

  const renderActivityItem = (activity: Activity, index: number) => {
    const config = ACTIVITY_CONFIG[activity.activityType]
    const isCreationEvent = activity.activityType === 'created'
    const activitySource = isCreationEvent
      ? (activity.metadata?.source as string) || reservationSource
      : undefined

    const Icon = isCreationEvent
      ? activitySource === 'manual'
        ? UserPlus
        : Globe
      : config.icon

    const paymentAmount = activity.metadata?.amount as number | undefined
    const paymentCurrency = (activity.metadata?.currency as string) || 'EUR'
    const isStripePayment = activity.metadata?.method === 'stripe'

    const isLastVisibleBeforeFade =
      !isExpanded && index === initialVisibleCount - 1 && hasMoreActivities

    return (
      <div
        key={activity.id}
        className={cn(
          'relative flex gap-3 pl-1 transition-opacity duration-300',
          isLastVisibleBeforeFade && 'opacity-60'
        )}
      >
        {/* Icon Circle */}
        <div
          className={cn(
            'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            config.bgColor
          )}
        >
          <Icon className={cn('h-4 w-4', config.iconColor)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">{t(`activity.${activity.activityType}`)}</p>
              {/* Source badge for creation events */}
              {activitySource && (
                <Badge
                  variant="secondary"
                  className={
                    activitySource === 'manual'
                      ? 'text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'text-[10px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  }
                >
                  {activitySource === 'manual' ? (
                    <>
                      <UserPlus className="h-2.5 w-2.5 mr-0.5" />
                      {t('sourceManual')}
                    </>
                  ) : (
                    <>
                      <Globe className="h-2.5 w-2.5 mr-0.5" />
                      {t('sourceOnline')}
                    </>
                  )}
                </Badge>
              )}
              {/* Stripe badge for online payment activities */}
              {(activity.activityType === 'payment_received' ||
                activity.activityType === 'payment_initiated' ||
                activity.activityType === 'payment_failed' ||
                activity.activityType === 'payment_expired') &&
                isStripePayment && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-4 bg-[#635BFF]/10 text-[#635BFF] border-0"
                  >
                    Stripe
                  </Badge>
                )}
              {/* Payment amount badge */}
              {paymentAmount &&
                (activity.activityType === 'payment_received' ||
                  activity.activityType === 'payment_initiated' ||
                  activity.activityType === 'payment_failed' ||
                  activity.activityType === 'payment_expired') && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] px-1.5 py-0 h-4 font-mono',
                      activity.activityType === 'payment_received'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : activity.activityType === 'payment_failed' ||
                            activity.activityType === 'payment_expired'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    )}
                  >
                    {activity.activityType === 'payment_received' ? '+' : ''}
                    {paymentAmount.toFixed(2)} {paymentCurrency}
                  </Badge>
                )}
              {/* Modified amount badge */}
              {activity.activityType === 'modified' &&
                activity.metadata?.difference !== undefined && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] px-1.5 py-0 h-4 font-mono',
                      (activity.metadata.difference as number) > 0
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : (activity.metadata.difference as number) < 0
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                    )}
                  >
                    {(activity.metadata.difference as number) >= 0 ? '+' : ''}
                    {(activity.metadata.difference as number).toFixed(2)} EUR
                  </Badge>
                )}
            </div>
            <time className="text-xs text-muted-foreground">
              {format(new Date(activity.createdAt), 'dd MMM yyyy HH:mm', { locale: fr })}
            </time>
          </div>

          {/* User info */}
          {activity.user && (
            <div className="flex items-center gap-2 mt-1">
              <Avatar className="h-4 w-4">
                <AvatarImage
                  src={activity.user.image || undefined}
                  alt={activity.user.name || activity.user.email}
                />
                <AvatarFallback className="text-[8px] bg-muted">
                  {getUserInitials(activity.user.name, activity.user.email)}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground">
                {t('activityBy')}{' '}
                <span className="font-medium text-foreground">
                  {activity.user.name || activity.user.email}
                </span>
              </span>
            </div>
          )}

          {/* Show "by customer" for online reservations/payments */}
          {!activity.user &&
            (activitySource === 'online' ||
              activity.activityType === 'payment_received' ||
              activity.activityType === 'payment_initiated' ||
              activity.activityType === 'payment_failed' ||
              activity.activityType === 'payment_expired') && (
              <div className="flex items-center gap-2 mt-1">
                <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted">
                  <User className="h-2.5 w-2.5 text-muted-foreground" />
                </div>
                <span className="text-xs text-muted-foreground">{t('activityByCustomer')}</span>
              </div>
            )}

          {/* Show "system" for other cases without user */}
          {!activity.user &&
            activitySource !== 'online' &&
            !activitySource &&
            ![
              'payment_received',
              'payment_initiated',
              'payment_failed',
              'payment_expired',
            ].includes(activity.activityType) && (
              <div className="flex items-center gap-2 mt-1">
                <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted">
                  <User className="h-2.5 w-2.5 text-muted-foreground" />
                </div>
                <span className="text-xs text-muted-foreground">{t('activitySystem')}</span>
              </div>
            )}

          {/* Description/Reason */}
          {activity.description && (
            <p className="mt-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 inline-block">
              {activity.description}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          {t('history')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-4">
            {sortedActivities.length === 0 ? (
              // Fallback: show creation event if no activities
              <div className="relative flex gap-3 pl-1">
                <div
                  className={cn(
                    'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10'
                  )}
                >
                  {isManualCreation ? (
                    <UserPlus className="h-4 w-4 text-primary" />
                  ) : (
                    <Globe className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{t('reservationCreated')}</p>
                      <Badge
                        variant="secondary"
                        className={
                          isManualCreation
                            ? 'text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'text-[10px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        }
                      >
                        {isManualCreation ? (
                          <>
                            <UserPlus className="h-2.5 w-2.5 mr-0.5" />
                            {t('sourceManual')}
                          </>
                        ) : (
                          <>
                            <Globe className="h-2.5 w-2.5 mr-0.5" />
                            {t('sourceOnline')}
                          </>
                        )}
                      </Badge>
                    </div>
                    <time className="text-xs text-muted-foreground">
                      {format(reservationCreatedAt, 'dd MMM yyyy HH:mm', { locale: fr })}
                    </time>
                  </div>
                </div>
              </div>
            ) : (
              visibleActivities.map((activity, index) => renderActivityItem(activity, index))
            )}
          </div>

          {/* Fade overlay when collapsed and has more */}
          {!isExpanded && hasMoreActivities && (
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-card via-card/80 to-transparent pointer-events-none" />
          )}
        </div>

        {/* Show more button */}
        {hasMoreActivities && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-3 text-xs"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              t('activity.showLess')
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5 mr-1" />
                {t('activity.showAll', { count: sortedActivities.length })}
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
