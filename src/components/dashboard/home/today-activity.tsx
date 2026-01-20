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
} from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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

interface ActivityCardProps {
  title: string
  description: string
  icon: React.ElementType
  iconColor: string
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
  reservations,
  emptyMessage,
  viewAllHref,
  showPeriod = false,
  showAmount = false,
  className,
}: ActivityCardProps) {
  const t = useTranslations('dashboard.home')
  const tRes = useTranslations('dashboard.reservations')

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className={cn('h-5 w-5', iconColor)} />
            {title}
          </CardTitle>
          <CardDescription className="text-sm">{description}</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild className="shrink-0">
          <Link href={viewAllHref}>
            {t('viewAll')}
            <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex-1">
        {reservations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="rounded-full bg-muted p-3">
              <CheckCircle className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">{tRes('number')}</TableHead>
                <TableHead>{tRes('customer')}</TableHead>
                {showPeriod && <TableHead>{tRes('period')}</TableHead>}
                {showAmount && (
                  <TableHead className="text-right">{tRes('total')}</TableHead>
                )}
                {!showPeriod && !showAmount && (
                  <TableHead>{t('products')}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.map((reservation) => (
                <TableRow key={reservation.id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/reservations/${reservation.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      #{reservation.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {reservation.customer.firstName}{' '}
                    {reservation.customer.lastName}
                  </TableCell>
                  {showPeriod && (
                    <TableCell className="text-sm text-muted-foreground">
                      {format(reservation.startDate, 'dd/MM', { locale: fr })} -{' '}
                      {format(reservation.endDate, 'dd/MM', { locale: fr })}
                    </TableCell>
                  )}
                  {showAmount && (
                    <TableCell className="text-right font-medium">
                      {formatCurrency(parseFloat(reservation.totalAmount))}
                    </TableCell>
                  )}
                  {!showPeriod && !showAmount && (
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {reservation.items
                        .map((item) => item.product?.name)
                        .filter(Boolean)
                        .join(', ')}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
      <Card className={className}>
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
        iconColor="text-emerald-500"
        reservations={departures}
        emptyMessage={t('activity.noDepartures')}
        viewAllHref="/dashboard/reservations?status=confirmed"
      />
      <ActivityCard
        title={t('activity.returns')}
        description={t('activity.returnsDescription')}
        icon={ArrowDownRight}
        iconColor="text-blue-500"
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
      icon={CheckCircle}
      iconColor="text-orange-500"
      reservations={pending}
      emptyMessage={t('pending.empty')}
      viewAllHref="/dashboard/reservations?status=pending"
      showPeriod
      showAmount
      className={className}
    />
  )
}
