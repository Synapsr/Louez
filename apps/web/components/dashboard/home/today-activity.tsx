'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle,
  ArrowRight,
  Package,
  Clock,
} from 'lucide-react'
import { cn, formatCurrency } from '@louez/utils'
import { Button } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'

interface ReservationWithDetails {
  id: string
  number: string
  startDate: Date
  endDate: Date
  totalAmount: string
  customer: {
    firstName: string
    lastName: string
  }
  items: Array<{
    id: string
    product: {
      name: string
    } | null
  }>
}

interface ActivityListItemProps {
  reservation: ReservationWithDetails
  showPeriod?: boolean
  showAmount?: boolean
}

function ActivityListItem({
  reservation,
  showPeriod = false,
  showAmount = false,
}: ActivityListItemProps) {
  const productNames = reservation.items
    .map((item) => item.product?.name)
    .filter(Boolean)
    .slice(0, 2)

  const remainingCount = reservation.items.length - 2

  // Get customer initials
  const initials = `${reservation.customer.firstName.charAt(0)}${reservation.customer.lastName.charAt(0)}`.toUpperCase()

  return (
    <Link
      href={`/dashboard/reservations/${reservation.id}`}
      className="list-item-hover group border-b border-transparent pr-12 last:border-b-0 hover:border-border/50"
    >
      {/* Customer Avatar with Initials */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/10 ring-2 ring-primary/5">
        <span className="text-sm font-semibold text-primary">
          {initials}
        </span>
      </div>

      {/* Main Content */}
      <div className="min-w-0 flex-1 space-y-0.5">
        {/* Customer Name & Reservation Number */}
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {reservation.customer.firstName} {reservation.customer.lastName}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            #{reservation.number}
          </span>
        </div>

        {/* Products or Period/Amount */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {showPeriod ? (
            <>
              <Clock className="h-3.5 w-3.5" />
              <span>
                {format(reservation.startDate, 'dd/MM', { locale: fr })} -{' '}
                {format(reservation.endDate, 'dd/MM', { locale: fr })}
              </span>
              {showAmount && (
                <>
                  <span className="text-muted-foreground/40">•</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(parseFloat(reservation.totalAmount))}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <Package className="h-3.5 w-3.5" />
              <span className="truncate">
                {productNames.join(', ')}
                {remainingCount > 0 && (
                  <span className="text-muted-foreground/60">
                    {' '}+{remainingCount}
                  </span>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Reveal Action Button */}
      <div className="reveal-action flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  )
}

interface ActivityCardProps {
  title: string
  description: string
  icon: React.ElementType
  iconColor: string
  iconBgColor: string
  reservations: ReservationWithDetails[]
  emptyMessage: string
  viewAllHref: string
  showPeriod?: boolean
  showAmount?: boolean
  className?: string
}

function ActivityCard({
  title,
  description,
  icon: Icon,
  iconColor,
  iconBgColor,
  reservations,
  emptyMessage,
  viewAllHref,
  showPeriod = false,
  showAmount = false,
  className,
}: ActivityCardProps) {
  const t = useTranslations('dashboard.home')

  return (
    <Card className={cn('stat-card flex flex-col', className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', iconBgColor)}>
            <Icon className={cn('h-5 w-5', iconColor)} />
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-sm">{description}</CardDescription>
          </div>
        </div>
        <Button variant="ghost" className="shrink-0 text-muted-foreground hover:text-foreground" render={<Link href={viewAllHref} />}>
            {t('viewAll')}
            <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        {reservations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="rounded-full bg-muted p-3">
              <CheckCircle className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          <div className="-mx-1 space-y-0.5">
            {reservations.map((reservation) => (
              <ActivityListItem
                key={reservation.id}
                reservation={reservation}
                showPeriod={showPeriod}
                showAmount={showAmount}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface TodayActivityProps {
  departures: ReservationWithDetails[]
  returns: ReservationWithDetails[]
  className?: string
}

export function TodayActivity({
  departures,
  returns,
  className,
}: TodayActivityProps) {
  const t = useTranslations('dashboard.home')

  // If no activity today, show a simpler view
  if (departures.length === 0 && returns.length === 0) {
    return (
      <Card className={cn('stat-card', className)}>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="rounded-full bg-muted p-4">
            <CheckCircle className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <h3 className="mt-4 font-medium">{t('activity.noActivityTitle')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('activity.noActivityDescription')}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={cn('grid gap-4 lg:grid-cols-2', className)}>
      <ActivityCard
        title={t('activity.departures')}
        description={t('activity.departuresDescription')}
        icon={ArrowUpRight}
        iconColor="text-emerald-600 dark:text-emerald-400"
        iconBgColor="bg-emerald-100 dark:bg-emerald-900/30"
        reservations={departures}
        emptyMessage={t('activity.noDepartures')}
        viewAllHref="/dashboard/reservations?status=confirmed"
      />
      <ActivityCard
        title={t('activity.returns')}
        description={t('activity.returnsDescription')}
        icon={ArrowDownRight}
        iconColor="text-blue-600 dark:text-blue-400"
        iconBgColor="bg-blue-100 dark:bg-blue-900/30"
        reservations={returns}
        emptyMessage={t('activity.noReturns')}
        viewAllHref="/dashboard/reservations?status=ongoing"
      />
    </div>
  )
}

interface PendingRequestsProps {
  pending: ReservationWithDetails[]
  className?: string
}

export function PendingRequests({ pending, className }: PendingRequestsProps) {
  const t = useTranslations('dashboard.home')

  // Don't render if no pending requests
  if (pending.length === 0) {
    return null
  }

  return (
    <ActivityCard
      title={t('pending.title')}
      description={t('pending.description')}
      icon={Clock}
      iconColor="text-amber-600 dark:text-amber-400"
      iconBgColor="bg-amber-100 dark:bg-amber-900/30"
      reservations={pending}
      emptyMessage={t('pending.empty')}
      viewAllHref="/dashboard/reservations?status=pending"
      showPeriod
      showAmount
      className={className}
    />
  )
}
