'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CreditCard,
  Shield,
  ShieldCheck,
  ShieldX,
  Clock,
  Loader2,
  AlertTriangle,
  Check,
  Banknote,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  Dialog,
  DialogPopup,
  DialogPanel,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Input } from '@louez/ui'
import { Label } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Progress } from '@louez/ui'
import { cn, getCurrencySymbol } from '@louez/utils'

import { orpc } from '@/lib/orpc/react'
import { invalidateReservationAll } from '@/lib/orpc/invalidation'

type DepositStatus = 'none' | 'pending' | 'card_saved' | 'authorized' | 'captured' | 'released' | 'failed'

interface PaymentMethodInfo {
  id: string
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
}

interface DepositSectionProps {
  reservationId: string
  depositAmount: string
  depositStatus: DepositStatus | null
  depositAuthorizationExpiresAt: Date | null
  stripePaymentMethodId: string | null
  currency?: string
}

const CARD_BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
}

export function DepositSection({
  reservationId,
  depositAmount,
  depositStatus,
  depositAuthorizationExpiresAt,
  stripePaymentMethodId,
  currency = 'EUR',
}: DepositSectionProps) {
  const t = useTranslations('dashboard.reservations.deposit')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const currencySymbol = getCurrencySymbol(currency)
  const queryClient = useQueryClient()

  const [isLoading, setIsLoading] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodInfo | null>(null)
  const [captureModalOpen, setCaptureModalOpen] = useState(false)
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)

  // Capture form state
  const [captureAmount, setCaptureAmount] = useState('')
  const [captureReason, setCaptureReason] = useState('')

  const amount = parseFloat(depositAmount)
  const status = depositStatus || 'pending'

  // Calculate time remaining for authorization
  const authorizationExpired = depositAuthorizationExpiresAt
    ? new Date(depositAuthorizationExpiresAt) < new Date()
    : false

  const authorizationTimeRemaining = depositAuthorizationExpiresAt
    ? formatDistanceToNow(new Date(depositAuthorizationExpiresAt), {
        locale: fr,
        addSuffix: true,
      })
    : null

  // Calculate progress for authorization countdown (7 days total)
  const getAuthorizationProgress = () => {
    if (!depositAuthorizationExpiresAt) return 0
    const expiresAt = new Date(depositAuthorizationExpiresAt).getTime()
    const now = Date.now()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    const createdAt = expiresAt - sevenDays
    const elapsed = now - createdAt
    const progress = Math.max(0, Math.min(100, (elapsed / sevenDays) * 100))
    return 100 - progress // Reverse for "time remaining"
  }

  const paymentMethodQuery = useQuery({
    ...orpc.dashboard.reservations.getPaymentMethod.queryOptions({
      input: { reservationId },
    }),
    enabled: Boolean(stripePaymentMethodId && status !== 'none'),
  })

  useEffect(() => {
    setPaymentMethod((paymentMethodQuery.data as PaymentMethodInfo | null) || null)
  }, [paymentMethodQuery.data])

  const createHoldMutation = useMutation(
    orpc.dashboard.reservations.createDepositHold.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservationId)
      },
    }),
  )

  const captureHoldMutation = useMutation(
    orpc.dashboard.reservations.captureDepositHold.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservationId)
      },
    }),
  )

  const releaseHoldMutation = useMutation(
    orpc.dashboard.reservations.releaseDepositHold.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservationId)
      },
    }),
  )

  const handleCreateHold = async () => {
    setIsLoading(true)
    try {
      await createHoldMutation.mutateAsync({ reservationId })
      toastManager.add({ title: t('holdCreated'), type: 'success' })
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCapture = async () => {
    const captureAmountNum = parseFloat(captureAmount)
    if (isNaN(captureAmountNum) || captureAmountNum <= 0) {
      toastManager.add({ title: t('invalidCaptureAmount'), type: 'error' })
      return
    }

    if (captureAmountNum > amount) {
      toastManager.add({ title: t('captureExceedsDeposit'), type: 'error' })
      return
    }

    if (!captureReason.trim()) {
      toastManager.add({ title: t('reasonRequired'), type: 'error' })
      return
    }

    setIsLoading(true)
    try {
      await captureHoldMutation.mutateAsync({
        reservationId,
        payload: { amount: captureAmountNum, reason: captureReason },
      })
      toastManager.add({ title: t('captured'), type: 'success' })
      setCaptureModalOpen(false)
      setCaptureAmount('')
      setCaptureReason('')
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRelease = async () => {
    setIsLoading(true)
    try {
      await releaseHoldMutation.mutateAsync({ reservationId })
      toastManager.add({ title: t('released'), type: 'success' })
      setReleaseDialogOpen(false)
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  // Don't show if no deposit required
  if (amount <= 0) {
    return null
  }

  const getStatusConfig = () => {
    switch (status) {
      case 'none':
        return {
          icon: Shield,
          iconClass: 'text-muted-foreground',
          badgeVariant: 'secondary' as const,
          badgeClass: '',
          label: t('status.none'),
        }
      case 'pending':
        return {
          icon: AlertTriangle,
          iconClass: 'text-amber-500',
          badgeVariant: 'secondary' as const,
          badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
          label: t('status.pending'),
        }
      case 'card_saved':
        return {
          icon: CreditCard,
          iconClass: 'text-blue-500',
          badgeVariant: 'secondary' as const,
          badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
          label: t('status.cardSaved'),
        }
      case 'authorized':
        return {
          icon: ShieldCheck,
          iconClass: 'text-amber-500',
          badgeVariant: 'secondary' as const,
          badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
          label: t('status.authorized'),
        }
      case 'captured':
        return {
          icon: Banknote,
          iconClass: 'text-red-500',
          badgeVariant: 'error' as const,
          badgeClass: '',
          label: t('status.captured'),
        }
      case 'released':
        return {
          icon: Check,
          iconClass: 'text-emerald-500',
          badgeVariant: 'secondary' as const,
          badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
          label: t('status.released'),
        }
      case 'failed':
        return {
          icon: ShieldX,
          iconClass: 'text-red-500',
          badgeVariant: 'error' as const,
          badgeClass: '',
          label: t('status.failed'),
        }
      default:
        return {
          icon: Shield,
          iconClass: 'text-muted-foreground',
          badgeVariant: 'secondary' as const,
          badgeClass: '',
          label: status,
        }
    }
  }

  const statusConfig = getStatusConfig()
  const StatusIcon = statusConfig.icon

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {t('title')}
            </CardTitle>
            <Badge variant={statusConfig.badgeVariant} className={statusConfig.badgeClass}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusConfig.label}
            </Badge>
          </div>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Deposit amount */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <span className="text-sm text-muted-foreground">{t('amount')}</span>
            <span className="font-semibold">
              {amount.toFixed(2)}{currencySymbol}
            </span>
          </div>

          {/* Saved card info */}
          {paymentMethod && status !== 'none' && status !== 'pending' && (
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {CARD_BRANDS[paymentMethod.brand || ''] || paymentMethod.brand}
                  {' '}
                  <span className="font-mono">****{paymentMethod.last4}</span>
                </span>
              </div>
              {paymentMethod.expMonth && paymentMethod.expYear && (
                <span className="text-xs text-muted-foreground">
                  {String(paymentMethod.expMonth).padStart(2, '0')}/{String(paymentMethod.expYear).slice(-2)}
                </span>
              )}
            </div>
          )}

          {/* Authorization expiration warning */}
          {status === 'authorized' && depositAuthorizationExpiresAt && (
            <div className={cn(
              'p-3 rounded-lg border space-y-2',
              authorizationExpired
                ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
                : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20'
            )}>
              <div className="flex items-center gap-2">
                <Clock className={cn(
                  'h-4 w-4',
                  authorizationExpired ? 'text-red-500' : 'text-amber-500'
                )} />
                <span className={cn(
                  'text-sm font-medium',
                  authorizationExpired
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-amber-700 dark:text-amber-400'
                )}>
                  {authorizationExpired ? t('expired') : t('expiresIn', { time: authorizationTimeRemaining ?? '' })}
                </span>
              </div>
              {!authorizationExpired && (
                <Progress value={getAuthorizationProgress()} className="h-1.5" />
              )}
            </div>
          )}

          {/* Status-specific messages */}
          {status === 'pending' && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    {t('pendingTitle')}
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    {t('pendingDescription')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {status === 'card_saved' && (
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900">
              <div className="flex items-start gap-2">
                <CreditCard className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
                    {t('cardSavedTitle')}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-500">
                    {t('cardSavedDescription')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {status === 'authorized' && !authorizationExpired && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    {t('authorizedTitle')}
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-500">
                    {t('authorizedDescription')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {status === 'released' && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-500" />
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  {t('releasedDescription')}
                </p>
              </div>
            </div>
          )}

          {status === 'captured' && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-red-500" />
                <p className="text-sm text-red-700 dark:text-red-400">
                  {t('capturedDescription')}
                </p>
              </div>
            </div>
          )}

          {status === 'failed' && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <p className="text-sm text-red-700 dark:text-red-400">
                  {t('failedDescription')}
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            {status === 'card_saved' && (
              <Button
                onClick={handleCreateHold}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                {t('createHold')}
              </Button>
            )}

            {status === 'authorized' && !authorizationExpired && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setReleaseDialogOpen(true)}
                  disabled={isLoading}
                  className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                >
                  <Check className="mr-2 h-4 w-4" />
                  {t('release')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCaptureAmount(amount.toFixed(2))
                    setCaptureModalOpen(true)
                  }}
                  disabled={isLoading}
                  className="flex-1 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                >
                  <Banknote className="mr-2 h-4 w-4" />
                  {t('capture')}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Capture Modal */}
      <Dialog open={captureModalOpen} onOpenChange={setCaptureModalOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              {t('captureTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('captureDescription')}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
          <div className="space-y-4">
            {/* Maximum amount info */}
            <div className="p-3 rounded-lg bg-muted text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('maxCapturable')}</span>
                <span className="font-medium">{amount.toFixed(2)}{currencySymbol}</span>
              </div>
            </div>

            {/* Amount input */}
            <div className="space-y-2">
              <Label htmlFor="captureAmount">{t('captureAmount')}</Label>
              <div className="relative">
                <Input
                  id="captureAmount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={amount}
                  value={captureAmount}
                  onChange={(e) => setCaptureAmount(e.target.value)}
                  placeholder="0.00"
                  className="pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {currencySymbol}
                </span>
              </div>
            </div>

            {/* Reason input */}
            <div className="space-y-2">
              <Label htmlFor="captureReason">
                {t('captureReason')} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="captureReason"
                value={captureReason}
                onChange={(e) => setCaptureReason(e.target.value)}
                placeholder={t('captureReasonPlaceholder')}
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {t('captureReasonHint')}
              </p>
            </div>
          </div>
          </DialogPanel>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCaptureModalOpen(false)}
              disabled={isLoading}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleCapture}
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('confirmCapture')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Release Confirmation Dialog */}
      <AlertDialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              {t('releaseTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('releaseDescription', { amount: `${amount.toFixed(2)}${currencySymbol}` })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />} disabled={isLoading}>
              {tCommon('cancel')}
            </AlertDialogClose>
            <AlertDialogClose
              render={<Button className="bg-emerald-600 text-white hover:bg-emerald-700" />}
              onClick={handleRelease}
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('confirmRelease')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
