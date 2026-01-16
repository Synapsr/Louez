import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { getTranslations } from 'next-intl/server'
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
  Shield,
  ShieldCheck,
  ShieldX,
  Banknote,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

type ActivityType = 'created' | 'confirmed' | 'rejected' | 'cancelled' | 'picked_up' | 'returned' | 'note_updated' | 'payment_added' | 'payment_updated' | 'deposit_authorized' | 'deposit_captured' | 'deposit_released' | 'deposit_failed'

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

interface ActivityTimelineProps {
  activities: Activity[]
  reservationCreatedAt: Date
  reservationSource: string | null
  createdByUser?: {
    id: string
    name: string | null
    email: string
    image: string | null
  } | null
}

const ACTIVITY_CONFIG: Record<ActivityType, {
  icon: React.ReactNode
  bgColor: string
  iconColor: string
}> = {
  created: {
    icon: <Plus className="h-4 w-4" />,
    bgColor: 'bg-primary/10',
    iconColor: 'text-primary',
  },
  confirmed: {
    icon: <CheckCircle className="h-4 w-4" />,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  rejected: {
    icon: <XCircle className="h-4 w-4" />,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  cancelled: {
    icon: <Ban className="h-4 w-4" />,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  picked_up: {
    icon: <ArrowUpRight className="h-4 w-4" />,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  returned: {
    icon: <ArrowDownRight className="h-4 w-4" />,
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  note_updated: {
    icon: <FileText className="h-4 w-4" />,
    bgColor: 'bg-gray-100 dark:bg-gray-900/50',
    iconColor: 'text-gray-600 dark:text-gray-400',
  },
  payment_added: {
    icon: <CreditCard className="h-4 w-4" />,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  payment_updated: {
    icon: <CreditCard className="h-4 w-4" />,
    bgColor: 'bg-amber-100 dark:bg-amber-950/50',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  deposit_authorized: {
    icon: <ShieldCheck className="h-4 w-4" />,
    bgColor: 'bg-amber-100 dark:bg-amber-950/50',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  deposit_captured: {
    icon: <Banknote className="h-4 w-4" />,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  deposit_released: {
    icon: <ShieldCheck className="h-4 w-4" />,
    bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  deposit_failed: {
    icon: <ShieldX className="h-4 w-4" />,
    bgColor: 'bg-red-100 dark:bg-red-950/50',
    iconColor: 'text-red-600 dark:text-red-400',
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

export async function ActivityTimeline({
  activities,
  reservationCreatedAt,
  reservationSource,
}: ActivityTimelineProps) {
  const t = await getTranslations('dashboard.reservations')

  // Sort activities by date (most recent first)
  const sortedActivities = [...activities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  // Find the creation activity to get source info
  const createdActivity = activities.find((a) => a.activityType === 'created')
  const isManualCreation = reservationSource === 'manual' ||
    (createdActivity?.metadata?.source === 'manual')

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
              <ActivityItem
                icon={isManualCreation ? <UserPlus className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                bgColor="bg-primary/10"
                iconColor="text-primary"
                title={t('reservationCreated')}
                source={isManualCreation ? 'manual' : 'online'}
                timestamp={reservationCreatedAt}
                user={null}
              />
            ) : (
              sortedActivities.map((activity) => {
                const config = ACTIVITY_CONFIG[activity.activityType]
                const isCreationEvent = activity.activityType === 'created'
                const activitySource = isCreationEvent
                  ? (activity.metadata?.source as string) || reservationSource
                  : undefined

                return (
                  <ActivityItem
                    key={activity.id}
                    icon={
                      isCreationEvent
                        ? activitySource === 'manual'
                          ? <UserPlus className="h-4 w-4" />
                          : <Globe className="h-4 w-4" />
                        : config.icon
                    }
                    bgColor={config.bgColor}
                    iconColor={config.iconColor}
                    title={t(`activity.${activity.activityType}`)}
                    subtitle={activity.description}
                    timestamp={activity.createdAt}
                    user={activity.user}
                    metadata={activity.metadata}
                    source={isCreationEvent ? activitySource : undefined}
                  />
                )
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface ActivityItemProps {
  icon: React.ReactNode
  bgColor: string
  iconColor: string
  title: string
  subtitle?: string | null
  timestamp: Date
  user: Activity['user']
  metadata?: Record<string, unknown> | null
  source?: string | null
}

async function ActivityItem({
  icon,
  bgColor,
  iconColor,
  title,
  subtitle,
  timestamp,
  user,
  source,
}: ActivityItemProps) {
  const t = await getTranslations('dashboard.reservations')

  return (
    <div className="relative flex gap-3 pl-1">
      {/* Icon Circle */}
      <div
        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${bgColor}`}
      >
        <span className={iconColor}>{icon}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm">{title}</p>
            {/* Source badge for creation events */}
            {source && (
              <Badge
                variant="secondary"
                className={
                  source === 'manual'
                    ? 'text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-[10px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                }
              >
                {source === 'manual' ? (
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
          </div>
          <time className="text-xs text-muted-foreground">
            {format(timestamp, 'dd MMM yyyy HH:mm', { locale: fr })}
          </time>
        </div>

        {/* User info */}
        {user && (
          <div className="flex items-center gap-2 mt-1">
            <Avatar className="h-4 w-4">
              <AvatarImage src={user.image || undefined} alt={user.name || user.email} />
              <AvatarFallback className="text-[8px] bg-muted">
                {getUserInitials(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground">
              {t('activityBy')} <span className="font-medium text-foreground">{user.name || user.email}</span>
            </span>
          </div>
        )}

        {/* Show "by customer" for online reservations without user */}
        {!user && source === 'online' && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted">
              <User className="h-2.5 w-2.5 text-muted-foreground" />
            </div>
            <span className="text-xs text-muted-foreground">
              {t('activityByCustomer')}
            </span>
          </div>
        )}

        {/* Show "system" for other cases without user */}
        {!user && source !== 'online' && !source && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted">
              <User className="h-2.5 w-2.5 text-muted-foreground" />
            </div>
            <span className="text-xs text-muted-foreground">
              {t('activitySystem')}
            </span>
          </div>
        )}

        {/* Description/Reason */}
        {subtitle && (
          <p className="mt-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 inline-block">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}
