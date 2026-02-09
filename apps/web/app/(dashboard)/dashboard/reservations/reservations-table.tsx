'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { formatStoreDateRange } from '@/lib/utils/store-date'
import {
  CheckCircle,
  XCircle,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Clock,
  User,
  ChevronRight,
  Loader2,
  Ban,
  AlertCircle,
  CreditCard,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useState } from 'react'

import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Card, CardContent } from '@louez/ui'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'

import {
  updateReservationStatus,
  cancelReservation,
} from './actions'
import { getCurrencySymbol } from '@louez/utils'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

interface ReservationItem {
  id: string
  quantity: number
  isCustomItem: boolean
  productSnapshot: {
    name: string
  }
  product: {
    id: string
    name: string
  } | null
}

interface Payment {
  id: string
  amount: string
  type: 'rental' | 'deposit' | 'deposit_return' | 'damage' | 'deposit_hold' | 'deposit_capture' | 'adjustment'
  method: 'cash' | 'card' | 'transfer' | 'check' | 'other' | 'stripe'
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'authorized' | 'cancelled'
}

interface Reservation {
  id: string
  number: string
  status: ReservationStatus | null
  startDate: Date
  endDate: Date
  subtotalAmount: string
  depositAmount: string
  totalAmount: string
  customer: {
    id: string
    firstName: string
    lastName: string
    email: string
  }
  items: ReservationItem[]
  payments: Payment[]
}

interface ReservationsTableProps {
  reservations: Reservation[]
  currency?: string
  timezone?: string
}

const STATUS_CONFIG: Record<ReservationStatus, {
  className: string
  bgClass: string
  icon: React.ReactNode
  borderClass: string
}> = {
  pending: {
    className: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-950/30',
    borderClass: 'border-l-amber-500',
    icon: <Clock className="h-4 w-4" />,
  },
  confirmed: {
    className: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-50 dark:bg-blue-950/30',
    borderClass: 'border-l-blue-500',
    icon: <CheckCircle className="h-4 w-4" />,
  },
  ongoing: {
    className: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderClass: 'border-l-emerald-500',
    icon: <Package className="h-4 w-4" />,
  },
  completed: {
    className: 'text-gray-600 dark:text-gray-400',
    bgClass: 'bg-gray-50 dark:bg-gray-900/30',
    borderClass: 'border-l-gray-400',
    icon: <CheckCircle className="h-4 w-4" />,
  },
  cancelled: {
    className: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-50 dark:bg-red-950/30',
    borderClass: 'border-l-red-500',
    icon: <Ban className="h-4 w-4" />,
  },
  rejected: {
    className: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-50 dark:bg-red-950/30',
    borderClass: 'border-l-red-500',
    icon: <XCircle className="h-4 w-4" />,
  },
}

type PaymentStatusType = 'paid' | 'partial' | 'unpaid'

function getPaymentStatus(reservation: Reservation): {
  status: PaymentStatusType
  rentalPaid: number
  depositCollected: number
  totalDue: number
  totalPaid: number
} {
  const rental = parseFloat(reservation.subtotalAmount)
  const deposit = parseFloat(reservation.depositAmount)
  const totalDue = rental + deposit

  const rentalPaid = reservation.payments
    .filter((p) => p.type === 'rental' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const depositCollected = reservation.payments
    .filter((p) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const totalPaid = rentalPaid + depositCollected

  let status: PaymentStatusType = 'unpaid'
  if (totalPaid >= totalDue) {
    status = 'paid'
  } else if (totalPaid > 0) {
    status = 'partial'
  }

  return { status, rentalPaid, depositCollected, totalDue, totalPaid }
}

export function ReservationsTable({ reservations, currency = 'EUR', timezone }: ReservationsTableProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const currencySymbol = getCurrencySymbol(currency)

  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null)

  const handleStatusChange = async (
    e: React.MouseEvent,
    reservation: Reservation,
    newStatus: ReservationStatus
  ) => {
    e.preventDefault()
    e.stopPropagation()

    setLoadingAction(`${reservation.id}-${newStatus}`)
    try {
      const result = await updateReservationStatus(reservation.id, newStatus)
      if (result.error) {
        toastManager.add({ title: result.error, type: 'error' })
      } else {
        const warnings = 'warnings' in result ? result.warnings : undefined
        if (warnings && warnings.length > 0) {
          const warningMessage = warnings
            .map((warning: { key: string; params?: Record<string, string | number> }) => {
              const key = warning.key.replace('errors.', '')
              return tErrors(key, warning.params || {})
            })
            .join(' • ')

          toastManager.add({ title: warningMessage, type: 'warning' })
        }

        toastManager.add({ title: t('statusUpdated'), type: 'success' })
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setLoadingAction(null)
    }
  }

  const handleReject = async () => {
    if (!selectedReservation) return

    setLoadingAction(`${selectedReservation.id}-reject`)
    try {
      const result = await updateReservationStatus(selectedReservation.id, 'rejected')
      if (result.error) {
        toastManager.add({ title: result.error, type: 'error' })
      } else {
        const warnings = 'warnings' in result ? result.warnings : undefined
        if (warnings && warnings.length > 0) {
          const warningMessage = warnings
            .map((warning: { key: string; params?: Record<string, string | number> }) => {
              const key = warning.key.replace('errors.', '')
              return tErrors(key, warning.params || {})
            })
            .join(' • ')

          toastManager.add({ title: warningMessage, type: 'warning' })
        }

        toastManager.add({ title: t('reservationRejected'), type: 'success' })
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setLoadingAction(null)
      setRejectDialogOpen(false)
      setSelectedReservation(null)
    }
  }

  const handleCancel = async () => {
    if (!selectedReservation) return

    setLoadingAction(`${selectedReservation.id}-cancel`)
    try {
      const result = await cancelReservation(selectedReservation.id)
      if (result.error) {
        toastManager.add({ title: result.error, type: 'error' })
      } else {
        toastManager.add({ title: t('reservationCancelled'), type: 'success' })
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setLoadingAction(null)
      setCancelDialogOpen(false)
      setSelectedReservation(null)
    }
  }

  const openRejectDialog = (e: React.MouseEvent, reservation: Reservation) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedReservation(reservation)
    setRejectDialogOpen(true)
  }

  const openCancelDialog = (e: React.MouseEvent, reservation: Reservation) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedReservation(reservation)
    setCancelDialogOpen(true)
  }

  if (reservations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
          <Calendar className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">{t('noReservations')}</h3>
        <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
          {t('noReservationsDescription')}
        </p>
        <Button render={<Link href="/dashboard/reservations/new" />} className="mt-6">
          {t('createReservation')}
        </Button>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {reservations.map((reservation) => {
          const status = reservation.status || 'pending'
          const statusConfig = STATUS_CONFIG[status]
          const isPending = status === 'pending'
          const isConfirmed = status === 'confirmed'
          const isOngoing = status === 'ongoing'
          const canCancel = !['cancelled', 'completed', 'rejected'].includes(status)

          const itemsText =
            reservation.items.length === 1
              ? reservation.items[0].productSnapshot.name
              : t('itemsCount', { count: reservation.items.length })

          const isLoading = loadingAction?.startsWith(reservation.id)

          // Calculate payment status
          const paymentInfo = getPaymentStatus(reservation)
          const showPaymentStatus = !['cancelled', 'rejected'].includes(status)

          // Check if there's a pending online payment (customer is on Stripe Checkout)
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
                          {statusConfig.icon}
                          {t(`status.${status}`)}
                        </Badge>
                        {/* Payment Status Badge */}
                        {showPaymentStatus && (
                          <Tooltip>
                            <TooltipTrigger render={<Badge
                                variant="secondary"
                                className={`gap-1 text-xs ${
                                  paymentInfo.status === 'paid'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    : paymentInfo.status === 'partial'
                                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                }`}
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
                                variant="default"
                                className="h-8 gap-1.5 bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
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
                                variant="outline"
                                className="h-8 gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:hover:bg-red-950"
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

                      {/* Cancel option for active reservations */}
                      {canCancel && !isPending && (
                        <Button
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground hover:text-destructive"
                          onClick={(e) => openCancelDialog(e, reservation)}
                          disabled={isLoading}
                        >
                          {t('actions.cancel')}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Reject Dialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('rejectConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('rejectConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{tCommon('back')}</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={handleReject}
            >
              {loadingAction?.includes('reject') ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('rejectRequest')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cancelConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{tCommon('back')}</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={handleCancel}
            >
              {loadingAction?.includes('cancel') ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('cancelReservation')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}
