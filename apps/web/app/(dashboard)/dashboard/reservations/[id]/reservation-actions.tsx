'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Clock,
  Package,
  Ban,
  AlertCircle,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import {
  Card,
  CardContent,
} from '@louez/ui'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Label } from '@louez/ui'

import { formatStoreDate } from '@/lib/utils/store-date'
import { useStoreTimezone } from '@/contexts/store-context'

import { updateReservationStatus, cancelReservation } from '../actions'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

interface ReservationActionsProps {
  reservationId: string
  status: ReservationStatus
  startDate: Date
  endDate: Date
  isDepositCollected?: boolean
  isRentalPaid?: boolean
  hasOnlinePaymentPending?: boolean
}

export function ReservationActions({
  reservationId,
  status,
  startDate,
  endDate,
  isDepositCollected = false,
  isRentalPaid = false,
  hasOnlinePaymentPending = false,
}: ReservationActionsProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const timezone = useStoreTimezone()

  const [isLoading, setIsLoading] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const handleStatusChange = async (newStatus: ReservationStatus, reason?: string) => {
    setIsLoading(true)
    try {
      const result = await updateReservationStatus(reservationId, newStatus, reason)
      if (result.error) {
        toastManager.add({ title: tErrors(result.error), type: 'error' })
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
      setIsLoading(false)
    }
  }

  const handleReject = async () => {
    await handleStatusChange('rejected', rejectionReason || undefined)
    setRejectDialogOpen(false)
    setRejectionReason('')
  }

  const handleCancel = async () => {
    setIsLoading(true)
    try {
      const result = await cancelReservation(reservationId)
      if (result.error) {
        toastManager.add({ title: tErrors(result.error), type: 'error' })
      } else {
        toastManager.add({ title: t('reservationCancelled'), type: 'success' })
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
      setCancelDialogOpen(false)
    }
  }

  const canCancel = !['cancelled', 'completed', 'rejected'].includes(status)

  // Render different card based on status
  const renderContent = () => {
    switch (status) {
      case 'pending':
        // If there's an online payment pending, show a different message
        if (hasOnlinePaymentPending) {
          return (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                    <Loader2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 animate-spin" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t('paymentPendingCard.title')}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('paymentPendingCard.description')}
                </p>
                {canCancel && (
                  <button
                    className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors pt-1"
                    onClick={() => setCancelDialogOpen(true)}
                    disabled={isLoading}
                  >
                    {t('cancelReservation')}
                  </button>
                )}
              </CardContent>
            </Card>
          )
        }

        // Standard request pending (manual approval needed)
        return (
          <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/50">
                  <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('pendingCard.title')}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('pendingCard.description')}
              </p>
              <div className="space-y-2">
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 text-white"
                  onClick={() => handleStatusChange('confirmed')}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-2 h-3.5 w-3.5" />
                  )}
                  {t('acceptRequest')}
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:hover:bg-red-950"
                  onClick={() => setRejectDialogOpen(true)}
                  disabled={isLoading}
                >
                  <XCircle className="mr-2 h-3.5 w-3.5" />
                  {t('rejectRequest')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )

      case 'confirmed':
        return (
          <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                  <CheckCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('confirmedCard.title')}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('confirmedCard.pickupOn', {
                  date: formatStoreDate(startDate, timezone, 'SHORT_DATETIME'),
                })}
              </p>

              <Button
                className="w-full"
                onClick={() => handleStatusChange('ongoing')}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpRight className="mr-2 h-3.5 w-3.5" />
                )}
                {t('actions.markPickedUp')}
              </Button>

              {/* Warning messages - compact */}
              {(!isDepositCollected || !isRentalPaid) && (
                <div className="space-y-1.5">
                  {!isDepositCollected && (
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      <p className="text-[11px]">{t('confirmedCard.depositWarning')}</p>
                    </div>
                  )}
                  {!isRentalPaid && (
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      <p className="text-[11px]">{t('confirmedCard.paymentWarning')}</p>
                    </div>
                  )}
                </div>
              )}

              {canCancel && (
                <div className="pt-2 border-t mt-3">
                  <button
                    className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => setCancelDialogOpen(true)}
                    disabled={isLoading}
                  >
                    {t('cancelReservation')}
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        )

      case 'ongoing':
        return (
          <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
                  <Package className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('ongoingCard.title')}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('ongoingCard.returnOn', {
                  date: formatStoreDate(endDate, timezone, 'SHORT_DATETIME'),
                })}
              </p>

              <Button
                className="w-full"
                onClick={() => handleStatusChange('completed')}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowDownRight className="mr-2 h-3.5 w-3.5" />
                )}
                {t('actions.markReturned')}
              </Button>

              {canCancel && (
                <div className="pt-2 border-t mt-3">
                  <button
                    className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => setCancelDialogOpen(true)}
                    disabled={isLoading}
                  >
                    {t('cancelReservation')}
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        )

      case 'completed':
        return (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                  <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('completedCard.title')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('completedCard.description')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )

      case 'cancelled':
        return (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                  <Ban className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('cancelledCard.title')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('cancelledCard.description')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )

      case 'rejected':
        return (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                  <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('rejectedCard.title')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('rejectedCard.description')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )

      default:
        return null
    }
  }

  return (
    <>
      {renderContent()}

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rejectDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('rejectDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rejection-reason">
              {t('rejectDialog.reasonLabel')}
            </Label>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={t('rejectDialog.reasonPlaceholder')}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {t('rejectDialog.reasonHint')}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('rejectRequest')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('cancelReservation')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
