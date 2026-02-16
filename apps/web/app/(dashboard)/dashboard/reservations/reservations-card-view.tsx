'use client'

import { formatStoreDateRange } from '@/lib/utils/store-date'
import { getCurrencySymbol } from '@louez/utils'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock,
  CreditCard,
  Loader2,
  Package,
  User,
  XCircle,
} from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  CardContent,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'

import type { Reservation, ReservationStatus } from './reservations-types'
import { STATUS_CONFIG, getPaymentStatus, PAYMENT_STATUS_CLASSES } from './reservations-utils'

const STATUS_ICON_MAP: Record<ReservationStatus, typeof Clock> = {
  pending: Clock,
  confirmed: CheckCircle,
  ongoing: Package,
  completed: CheckCircle,
  cancelled: Ban,
  rejected: XCircle,
}

interface ReservationsCardViewProps {
  reservations: Reservation[]
  currency?: string
  timezone?: string
  loadingAction: string | null
  handleStatusChange: (
    e: React.MouseEvent,
    reservation: Reservation,
    newStatus: ReservationStatus
  ) => Promise<void>
  openRejectDialog: (e: React.MouseEvent, reservation: Reservation) => void
}

export function ReservationsCardView({
  reservations,
  currency = 'EUR',
  timezone,
  loadingAction,
  handleStatusChange,
  openRejectDialog,
}: ReservationsCardViewProps) {
  const t = useTranslations('dashboard.reservations')
  const currencySymbol = getCurrencySymbol(currency)

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {reservations.map((reservation) => {
          const status = (reservation.status ?? 'pending') as ReservationStatus
          const statusConfig = STATUS_CONFIG[status]
          const StatusIcon = STATUS_ICON_MAP[status]
          const isPending = status === 'pending'
          const isConfirmed = status === 'confirmed'
          const isOngoing = status === 'ongoing'
          const itemsText =
            reservation.items.length === 1
              ? reservation.items[0].productSnapshot.name
              : t('itemsCount', { count: reservation.items.length })

          const isLoading = loadingAction?.startsWith(reservation.id)

          const paymentInfo = getPaymentStatus(reservation)
          const showPaymentStatus = !['cancelled', 'rejected'].includes(status)

          const hasPendingOnlinePayment = reservation.payments.some(
            (p) => p.method === 'stripe' && p.status === 'pending' && p.type === 'rental'
          )

          return (
            <Link
              key={reservation.id}
              href={`/dashboard/reservations/${reservation.id}`}
              className="block group"
            >
              <Card className={`
                transition-all duration-200
                hover:shadow-md hover:border-primary/20
                border-l-4 ${statusConfig.borderClass}
                ${isPending ? 'ring-1 ring-amber-200 dark:ring-amber-800/50' : ''}
              `}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Main Info */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Header Row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-sm font-semibold">
                          #{reservation.number}
                        </span>
                        <Badge
                          variant="secondary"
                          className={`gap-1.5 ${statusConfig.bgClass} ${statusConfig.className} border-0 ${isPending ? 'animate-pulse' : ''}`}
                        >
                          <StatusIcon className="h-4 w-4" />
                          {t(`status.${status}`)}
                        </Badge>
                        {/* Payment Status Badge */}
                        {showPaymentStatus && (
                          <Tooltip>
                            <TooltipTrigger render={<Badge
                                variant="secondary"
                                className={`gap-1 text-xs ${PAYMENT_STATUS_CLASSES[paymentInfo.status]}`}
                              />}>
                                {paymentInfo.status === 'paid' ? (
                                  <CheckCircle className="h-3 w-3" />
                                ) : (
                                  <AlertCircle className="h-3 w-3" />
                                )}
                                {t(`paymentStatus.${paymentInfo.status}`)}
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs">
                                <p>{paymentInfo.totalPaid.toFixed(2)} {currencySymbol} / {paymentInfo.totalDue.toFixed(2)} {currencySymbol}</p>
                                {paymentInfo.status !== 'paid' && (
                                  <p className="text-red-400">
                                    {t('payment.unpaidWarning', {
                                      formattedAmount: `${(paymentInfo.totalDue - paymentInfo.totalPaid).toFixed(2)} ${currencySymbol}`,
                                    })}
                                  </p>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>

                      {/* Customer & Items */}
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm">
                        <span className="flex items-center gap-1.5 text-foreground">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          {reservation.customer.firstName} {reservation.customer.lastName}
                        </span>
                        <span className="text-muted-foreground truncate">
                          {itemsText}
                        </span>
                      </div>

                      {/* Dates */}
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatStoreDateRange(reservation.startDate, reservation.endDate, timezone)}
                      </div>
                    </div>

                    {/* Right: Amount & Actions */}
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-lg">
                          {parseFloat(reservation.totalAmount).toFixed(2)} {currencySymbol}
                        </span>
                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>

                      {/* Quick Actions for Pending */}
                      {isPending && !hasPendingOnlinePayment && (
                        <div className="flex items-center gap-1.5">
                          <Tooltip>
                            <TooltipTrigger render={<Button
                                variant="success"
                                className="h-8 gap-1.5"
                                onClick={(e) => handleStatusChange(e, reservation, 'confirmed')}
                                disabled={isLoading}
                              />}>
                                {loadingAction === `${reservation.id}-confirmed` ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle className="h-3.5 w-3.5" />
                                )}
                                <span className="hidden sm:inline">{t('actions.accept')}</span>
                            </TooltipTrigger>
                            <TooltipContent>{t('actions.accept')}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger render={<Button
                                variant="destructive-outline"
                                className="h-8 gap-1.5"
                                onClick={(e) => openRejectDialog(e, reservation)}
                                disabled={isLoading}
                              />}>
                                <XCircle className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">{t('actions.reject')}</span>
                            </TooltipTrigger>
                            <TooltipContent>{t('actions.reject')}</TooltipContent>
                          </Tooltip>
                        </div>
                      )}

                      {/* Pending online payment indicator */}
                      {isPending && hasPendingOnlinePayment && (
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="secondary"
                            className="gap-1.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse"
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            {t('paymentInProgress')}
                          </Badge>
                        </div>
                      )}

                      {/* Quick Actions for Confirmed */}
                      {isConfirmed && (
                        <Tooltip>
                          <TooltipTrigger render={<Button
                              variant="outline"
                              className="h-8 gap-1.5"
                              onClick={(e) => handleStatusChange(e, reservation, 'ongoing')}
                              disabled={isLoading}
                            />}>
                              {loadingAction === `${reservation.id}-ongoing` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              )}
                              <span className="hidden sm:inline">{t('actions.markPickedUp')}</span>
                          </TooltipTrigger>
                          <TooltipContent>{t('actions.markPickedUp')}</TooltipContent>
                        </Tooltip>
                      )}

                      {/* Quick Actions for Ongoing */}
                      {isOngoing && (
                        <Tooltip>
                          <TooltipTrigger render={<Button
                              variant="outline"
                              className="h-8 gap-1.5"
                              onClick={(e) => handleStatusChange(e, reservation, 'completed')}
                              disabled={isLoading}
                            />}>
                              {loadingAction === `${reservation.id}-completed` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ArrowDownRight className="h-3.5 w-3.5" />
                              )}
                              <span className="hidden sm:inline">{t('actions.markReturned')}</span>
                          </TooltipTrigger>
                          <TooltipContent>{t('actions.markReturned')}</TooltipContent>
                        </Tooltip>
                      )}

                      {/* Cancel is available from the detail page */}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
