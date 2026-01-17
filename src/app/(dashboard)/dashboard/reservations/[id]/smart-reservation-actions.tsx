'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  CheckCircle,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Clock,
  Package,
  Ban,
  AlertTriangle,
  CreditCard,
  Shield,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { cn, getCurrencySymbol } from '@/lib/utils'

import { updateReservationStatus, cancelReservation } from '../actions'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

interface SmartReservationActionsProps {
  reservationId: string
  status: ReservationStatus
  startDate: Date
  endDate: Date
  // Payment info
  rentalAmount: number
  rentalPaid: number
  depositAmount: number
  depositCollected: number
  depositReturned: number
  // Flags
  hasOnlinePaymentPending?: boolean
  hasActiveAuthorization?: boolean
  currency?: string
}

export function SmartReservationActions({
  reservationId,
  status,
  startDate,
  endDate,
  rentalAmount,
  rentalPaid,
  depositAmount,
  depositCollected,
  depositReturned,
  hasOnlinePaymentPending = false,
  hasActiveAuthorization = false,
  currency = 'EUR',
}: SmartReservationActionsProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const currencySymbol = getCurrencySymbol(currency)

  const [isLoading, setIsLoading] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [pickupConfirmOpen, setPickupConfirmOpen] = useState(false)
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false)

  // Calculate payment states
  const isRentalFullyPaid = rentalPaid >= rentalAmount
  const isDepositFullyCollected = depositCollected >= depositAmount
  const rentalRemaining = Math.max(0, rentalAmount - rentalPaid)
  const depositRemaining = Math.max(0, depositAmount - depositCollected)
  const depositToReturn = depositCollected - depositReturned

  // Determine warnings
  const hasPaymentWarning = !isRentalFullyPaid && status === 'confirmed'
  const hasDepositWarning = depositAmount > 0 && !isDepositFullyCollected && status === 'confirmed'
  const hasWarnings = hasPaymentWarning || hasDepositWarning

  const handleStatusChange = async (newStatus: ReservationStatus, reason?: string) => {
    setIsLoading(true)
    try {
      const result = await updateReservationStatus(reservationId, newStatus, reason)
      if (result.error) {
        toast.error(tErrors(result.error))
      } else {
        toast.success(t('statusUpdated'))
        router.refresh()
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
      setAcknowledgeWarnings(false)
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
        toast.error(tErrors(result.error))
      } else {
        toast.success(t('reservationCancelled'))
        router.refresh()
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
      setCancelDialogOpen(false)
    }
  }

  const handlePickup = async () => {
    await handleStatusChange('ongoing')
    setPickupConfirmOpen(false)
  }

  const handleReturn = async () => {
    await handleStatusChange('completed')
    setReturnConfirmOpen(false)
  }

  const canCancel = !['cancelled', 'completed', 'rejected'].includes(status)

  // Render based on status
  const renderContent = () => {
    switch (status) {
      case 'pending':
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
              <p className="text-xs text-muted-foreground">{t('pendingCard.description')}</p>
              <div className="space-y-2">
                <Button
                  size="sm"
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
                  size="sm"
                  variant="outline"
                  className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:hover:bg-red-950"
                  onClick={() => setRejectDialogOpen(true)}
                  disabled={isLoading}
                >
                  <XCircle className="mr-2 h-3.5 w-3.5" />
                  {t('rejectRequest')}
                </Button>
              </div>
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
                  date: format(startDate, "EEE d MMM 'à' HH:mm", { locale: fr }),
                })}
              </p>

              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  if (hasWarnings) {
                    setPickupConfirmOpen(true)
                  } else {
                    handlePickup()
                  }
                }}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpRight className="mr-2 h-3.5 w-3.5" />
                )}
                {t('actions.markPickedUp')}
              </Button>

              {/* Inline warnings */}
              {hasWarnings && (
                <div className="space-y-1.5 pt-1">
                  {hasPaymentWarning && (
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <CreditCard className="h-3 w-3 shrink-0" />
                      <p className="text-[11px]">
                        {t('smartActions.paymentIncomplete', {
                          remaining: `${rentalRemaining.toFixed(2)}${currencySymbol}`,
                        })}
                      </p>
                    </div>
                  )}
                  {hasDepositWarning && (
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <Shield className="h-3 w-3 shrink-0" />
                      <p className="text-[11px]">
                        {t('smartActions.depositNotCollected', {
                          amount: `${depositRemaining.toFixed(2)}${currencySymbol}`,
                        })}
                      </p>
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
                  date: format(endDate, "EEE d MMM 'à' HH:mm", { locale: fr }),
                })}
              </p>

              <Button
                size="sm"
                className="w-full"
                onClick={() => setReturnConfirmOpen(true)}
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
                  <p className="text-xs text-muted-foreground">{t('completedCard.description')}</p>
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
                  <p className="text-xs text-muted-foreground">{t('cancelledCard.description')}</p>
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
                  <p className="text-xs text-muted-foreground">{t('rejectedCard.description')}</p>
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
            <DialogDescription>{t('rejectDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rejection-reason">{t('rejectDialog.reasonLabel')}</Label>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={t('rejectDialog.reasonPlaceholder')}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">{t('rejectDialog.reasonHint')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={isLoading}>
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
            <AlertDialogDescription>{t('cancelConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('back')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('cancelReservation')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pickup Confirmation with Warnings */}
      <Dialog open={pickupConfirmOpen} onOpenChange={setPickupConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t('smartActions.pickupConfirmTitle')}
            </DialogTitle>
            <DialogDescription>{t('smartActions.pickupConfirmDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Warnings Box */}
            <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 space-y-3">
              {hasPaymentWarning && (
                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 shrink-0">
                    <CreditCard className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      {t('smartActions.warningPaymentTitle')}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      {t('smartActions.warningPaymentDescription', {
                        paid: `${rentalPaid.toFixed(2)}${currencySymbol}`,
                        total: `${rentalAmount.toFixed(2)}${currencySymbol}`,
                        remaining: `${rentalRemaining.toFixed(2)}${currencySymbol}`,
                      })}
                    </p>
                  </div>
                </div>
              )}

              {hasDepositWarning && (
                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 shrink-0">
                    <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      {t('smartActions.warningDepositTitle')}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      {t('smartActions.warningDepositDescription', {
                        amount: `${depositRemaining.toFixed(2)}${currencySymbol}`,
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Acknowledgment checkbox */}
            <div className="flex items-start space-x-3">
              <Checkbox
                id="acknowledge-pickup"
                checked={acknowledgeWarnings}
                onCheckedChange={(checked) => setAcknowledgeWarnings(checked === true)}
              />
              <label
                htmlFor="acknowledge-pickup"
                className="text-sm text-muted-foreground leading-tight cursor-pointer"
              >
                {t('smartActions.acknowledgePickupWarnings')}
              </label>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setPickupConfirmOpen(false)} className="sm:flex-1">
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={handlePickup}
              disabled={isLoading || !acknowledgeWarnings}
              className={cn(
                'sm:flex-1',
                acknowledgeWarnings
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : ''
              )}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <ArrowUpRight className="mr-2 h-4 w-4" />
              {t('smartActions.confirmPickup')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return Confirmation */}
      <Dialog open={returnConfirmOpen} onOpenChange={setReturnConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownRight className="h-5 w-5 text-blue-500" />
              {t('smartActions.returnConfirmTitle')}
            </DialogTitle>
            <DialogDescription>{t('smartActions.returnConfirmDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Status summary */}
            <div className="p-4 rounded-lg bg-muted/50 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('payment.rental')}</span>
                <span className={cn('font-medium', isRentalFullyPaid ? 'text-emerald-600' : 'text-amber-600')}>
                  {isRentalFullyPaid
                    ? t('smartActions.fullyPaid')
                    : t('smartActions.partiallyPaid', {
                        paid: `${rentalPaid.toFixed(2)}${currencySymbol}`,
                        total: `${rentalAmount.toFixed(2)}${currencySymbol}`,
                      })}
                </span>
              </div>

              {depositAmount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('payment.deposit')}</span>
                  <span className={cn('font-medium', isDepositFullyCollected ? 'text-emerald-600' : 'text-amber-600')}>
                    {isDepositFullyCollected
                      ? `${depositCollected.toFixed(2)}${currencySymbol} ${t('smartActions.collected')}`
                      : t('smartActions.notCollected')}
                  </span>
                </div>
              )}

              {depositToReturn > 0 && (
                <div className="flex items-center justify-between text-sm pt-2 border-t">
                  <span className="text-muted-foreground">{t('smartActions.toReturnToCustomer')}</span>
                  <span className="font-medium text-blue-600">
                    {depositToReturn.toFixed(2)}
                    {currencySymbol}
                  </span>
                </div>
              )}
            </div>

            <p className="text-sm text-muted-foreground">{t('smartActions.returnQuestion')}</p>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setReturnConfirmOpen(false)} className="sm:flex-1">
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleReturn} disabled={isLoading} className="sm:flex-1">
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <CheckCircle className="mr-2 h-4 w-4" />
              {t('smartActions.confirmReturn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
