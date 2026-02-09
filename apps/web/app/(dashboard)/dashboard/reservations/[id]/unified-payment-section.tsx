'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  CreditCard,
  Plus,
  Check,
  AlertCircle,
  ArrowDownLeft,
  Trash2,
  Loader2,
  Banknote,
  Building2,
  Wallet,
  Receipt,
  ChevronDown,
  ChevronUp,
  Shield,
  ShieldCheck,
  Clock,
  Wifi,
  X,
  Send,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  Dialog,
  DialogContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { Input } from '@louez/ui'
import { Label } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Progress } from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { cn, getCurrencySymbol } from '@louez/utils'

import { formatStoreDate } from '@/lib/utils/store-date'
import { useStoreTimezone } from '@/contexts/store-context'
import {
  recordPayment,
  deletePayment,
  returnDeposit,
  recordDamage,
  createDepositHold,
  captureDepositHold,
  releaseDepositHold,
  getReservationPaymentMethod,
  type PaymentType,
  type PaymentMethod,
} from '../actions'
import { RequestPaymentModal } from './request-payment-modal'

interface Payment {
  id: string
  amount: string
  type: 'rental' | 'deposit' | 'deposit_return' | 'damage' | 'deposit_hold' | 'deposit_capture' | 'adjustment'
  method: 'stripe' | 'cash' | 'card' | 'transfer' | 'check' | 'other'
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'authorized' | 'cancelled'
  paidAt: Date | null
  notes: string | null
  stripeChargeId?: string | null
  stripePaymentIntentId?: string | null
  stripeCheckoutSessionId?: string | null
}

interface PaymentMethodInfo {
  id: string
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
}

type DepositStatus = 'none' | 'pending' | 'card_saved' | 'authorized' | 'captured' | 'released' | 'failed'

interface UnifiedPaymentSectionProps {
  reservationId: string
  reservationNumber: string
  subtotalAmount: string
  depositAmount: string
  totalAmount: string
  payments: Payment[]
  status: string
  currency?: string
  // Deposit authorization props
  depositStatus: DepositStatus | null
  depositAuthorizationExpiresAt: Date | null
  stripePaymentMethodId: string | null
  // Request payment props
  customer: {
    firstName: string
    email: string
    phone?: string | null
  }
  stripeConfigured: boolean
}

const METHOD_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote className="h-3.5 w-3.5" />,
  card: <CreditCard className="h-3.5 w-3.5" />,
  transfer: <Building2 className="h-3.5 w-3.5" />,
  check: <Receipt className="h-3.5 w-3.5" />,
  stripe: <CreditCard className="h-3.5 w-3.5 text-[#635BFF]" />,
  other: <Wallet className="h-3.5 w-3.5" />,
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

const VISIBLE_HISTORY_COUNT = 3

export function UnifiedPaymentSection({
  reservationId,
  reservationNumber,
  subtotalAmount,
  depositAmount,
  totalAmount,
  payments,
  status,
  currency = 'EUR',
  depositStatus: depositStatusProp,
  depositAuthorizationExpiresAt,
  stripePaymentMethodId,
  customer,
  stripeConfigured,
}: UnifiedPaymentSectionProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const timezone = useStoreTimezone()
  const currencySymbol = getCurrencySymbol(currency)

  const [isLoading, setIsLoading] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [depositReturnModalOpen, setDepositReturnModalOpen] = useState(false)
  const [damageModalOpen, setDamageModalOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [captureModalOpen, setCaptureModalOpen] = useState(false)
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)
  const [requestPaymentModalOpen, setRequestPaymentModalOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodInfo | null>(null)

  // Form state
  const [paymentType, setPaymentType] = useState<PaymentType>('rental')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethodType, setPaymentMethodType] = useState<PaymentMethod>('cash')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [captureAmount, setCaptureAmount] = useState('')
  const [captureReason, setCaptureReason] = useState('')

  // Calculate totals
  const rental = parseFloat(subtotalAmount)
  const deposit = parseFloat(depositAmount)
  const depositStatusVal = depositStatusProp || 'none'

  const rentalPaid = payments
    .filter((p) => p.type === 'rental' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const depositCollected = payments
    .filter((p) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const depositReturned = payments
    .filter((p) => p.type === 'deposit_return' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const damagesPaid = payments
    .filter((p) => p.type === 'damage' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const rentalRemaining = Math.max(0, rental - rentalPaid)
  const depositRemaining = Math.max(0, deposit - depositCollected)
  const depositToReturn = depositCollected - depositReturned

  const isRentalFullyPaid = rentalRemaining === 0
  const isDepositFullyCollected = depositRemaining === 0
  const isDepositFullyReturned = depositToReturn <= 0 && depositCollected > 0

  const isReservationFinished = ['completed', 'cancelled', 'rejected'].includes(status)

  // Stripe payment info
  const stripeRentalPayment = payments.find(
    (p) => p.method === 'stripe' && p.type === 'rental' && p.status === 'completed'
  )
  const stripePendingPayment = payments.find(
    (p) => p.method === 'stripe' && p.type === 'rental' && p.status === 'pending'
  )

  // Authorization expiration
  const authorizationExpired = depositAuthorizationExpiresAt
    ? new Date(depositAuthorizationExpiresAt) < new Date()
    : false

  const authorizationTimeRemaining = depositAuthorizationExpiresAt
    ? formatDistanceToNow(new Date(depositAuthorizationExpiresAt), {
        locale: fr,
        addSuffix: false,
      })
    : null

  const getAuthorizationProgress = () => {
    if (!depositAuthorizationExpiresAt) return 0
    const expiresAt = new Date(depositAuthorizationExpiresAt).getTime()
    const now = Date.now()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    const createdAt = expiresAt - sevenDays
    const elapsed = now - createdAt
    const progress = Math.max(0, Math.min(100, (elapsed / sevenDays) * 100))
    return 100 - progress
  }

  // Fetch payment method details
  useEffect(() => {
    if (stripePaymentMethodId && depositStatusVal !== 'none') {
      getReservationPaymentMethod(reservationId).then(setPaymentMethod)
    }
  }, [reservationId, stripePaymentMethodId, depositStatusVal])

  // Filter history payments (exclude pending Stripe)
  const historyPayments = payments.filter(
    (p) => !(p.method === 'stripe' && p.status === 'pending')
  )
  const visiblePayments = historyExpanded
    ? historyPayments
    : historyPayments.slice(0, VISIBLE_HISTORY_COUNT)
  const hasMorePayments = historyPayments.length > VISIBLE_HISTORY_COUNT

  const resetForm = () => {
    setPaymentAmount('')
    setPaymentMethodType('cash')
    setPaymentNotes('')
  }

  // Payment handlers
  const handleRecordPayment = async () => {
    const amount = parseFloat(paymentAmount)
    if (isNaN(amount) || amount === 0) {
      toastManager.add({ title: t('payment.invalidAmount'), type: 'error' })
      return
    }
    if (amount < 0 && paymentType !== 'adjustment') {
      toastManager.add({ title: t('payment.negativeAmountOnlyForAdjustment'), type: 'error' })
      return
    }

    setIsLoading(true)
    try {
      const result = await recordPayment(reservationId, {
        type: paymentType,
        amount,
        method: paymentMethodType,
        notes: paymentNotes || undefined,
      })

      if (result.error) {
        toastManager.add({ title: tErrors(result.error), type: 'error' })
      } else {
        toastManager.add({ title: t('payment.recorded'), type: 'success' })
        setPaymentModalOpen(false)
        resetForm()
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleReturnDeposit = async () => {
    const amount = parseFloat(paymentAmount)
    if (isNaN(amount) || amount <= 0) {
      toastManager.add({ title: t('payment.invalidAmount'), type: 'error' })
      return
    }

    if (amount > depositToReturn) {
      toastManager.add({ title: t('payment.amountExceedsDeposit'), type: 'error' })
      return
    }

    setIsLoading(true)
    try {
      const result = await returnDeposit(reservationId, {
        amount,
        method: paymentMethodType,
        notes: paymentNotes || undefined,
      })

      if (result.error) {
        toastManager.add({ title: tErrors(result.error), type: 'error' })
      } else {
        toastManager.add({ title: t('payment.depositReturned'), type: 'success' })
        setDepositReturnModalOpen(false)
        resetForm()
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRecordDamage = async () => {
    const amount = parseFloat(paymentAmount)
    if (isNaN(amount) || amount <= 0) {
      toastManager.add({ title: t('payment.invalidAmount'), type: 'error' })
      return
    }

    if (!paymentNotes.trim()) {
      toastManager.add({ title: t('payment.damageNotesRequired'), type: 'error' })
      return
    }

    setIsLoading(true)
    try {
      const result = await recordDamage(reservationId, {
        amount,
        method: paymentMethodType,
        notes: paymentNotes,
      })

      if (result.error) {
        toastManager.add({ title: tErrors(result.error), type: 'error' })
      } else {
        toastManager.add({ title: t('payment.damageRecorded'), type: 'success' })
        setDamageModalOpen(false)
        resetForm()
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeletePayment = async () => {
    if (!paymentToDelete) return

    setIsLoading(true)
    try {
      const result = await deletePayment(paymentToDelete.id)

      if (result.error) {
        toastManager.add({ title: tErrors(result.error), type: 'error' })
      } else {
        toastManager.add({ title: t('payment.deleted'), type: 'success' })
        setDeleteDialogOpen(false)
        setPaymentToDelete(null)
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  // Deposit authorization handlers
  const handleCreateHold = async () => {
    setIsLoading(true)
    try {
      const result = await createDepositHold(reservationId)
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
      } else {
        toastManager.add({ title: t('deposit.holdCreated'), type: 'success' })
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCapture = async () => {
    const captureAmountNum = parseFloat(captureAmount)
    if (isNaN(captureAmountNum) || captureAmountNum <= 0) {
      toastManager.add({ title: t('deposit.invalidCaptureAmount'), type: 'error' })
      return
    }

    if (captureAmountNum > deposit) {
      toastManager.add({ title: t('deposit.captureExceedsDeposit'), type: 'error' })
      return
    }

    if (!captureReason.trim()) {
      toastManager.add({ title: t('deposit.reasonRequired'), type: 'error' })
      return
    }

    setIsLoading(true)
    try {
      const result = await captureDepositHold(reservationId, {
        amount: captureAmountNum,
        reason: captureReason,
      })
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
      } else {
        toastManager.add({ title: t('deposit.captured'), type: 'success' })
        setCaptureModalOpen(false)
        setCaptureAmount('')
        setCaptureReason('')
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRelease = async () => {
    setIsLoading(true)
    try {
      const result = await releaseDepositHold(reservationId)
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
      } else {
        toastManager.add({ title: t('deposit.released'), type: 'success' })
        setReleaseDialogOpen(false)
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const openPaymentModal = (type: PaymentType, suggestedAmount?: number) => {
    setPaymentType(type)
    setPaymentAmount(suggestedAmount?.toFixed(2) || '')
    setPaymentModalOpen(true)
  }

  const suggestedReturnAmount = Math.max(0, depositToReturn - damagesPaid)

  const openDepositReturnModal = () => {
    setPaymentAmount(suggestedReturnAmount.toFixed(2))
    setDepositReturnModalOpen(true)
  }

  const getMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      cash: t('payment.methods.cash'),
      card: t('payment.methods.card'),
      transfer: t('payment.methods.transfer'),
      check: t('payment.methods.check'),
      stripe: t('payment.methods.stripe'),
      other: t('payment.methods.other'),
    }
    return labels[method] || method
  }

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      rental: t('payment.types.rental'),
      deposit: t('payment.types.deposit'),
      deposit_return: t('payment.types.depositReturn'),
      damage: t('payment.types.damage'),
      deposit_hold: t('payment.types.depositHold'),
      deposit_capture: t('payment.types.depositCapture'),
      adjustment: t('payment.types.adjustment'),
    }
    return labels[type] || type
  }

  // Global payment status
  const isFullyPaid = isRentalFullyPaid && (deposit === 0 || isDepositFullyCollected)
  const hasDepositToReturn = deposit > 0 && depositToReturn > 0 && !isDepositFullyReturned

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              {t('payment.title')}
            </CardTitle>
            {isFullyPaid && !hasDepositToReturn ? (
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              >
                <Check className="h-3 w-3 mr-1" />
                {t('payment.allPaidBadge')}
              </Badge>
            ) : hasDepositToReturn ? (
              <Badge
                variant="secondary"
                className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              >
                <ArrowDownLeft className="h-3 w-3 mr-1" />
                {t('payment.depositToReturnBadge')}
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              >
                <AlertCircle className="h-3 w-3 mr-1" />
                {t('payment.pendingBadge')}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Stripe Payment Pending */}
          {stripePendingPayment && !stripeRentalPayment && (
            <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-full bg-blue-100 dark:bg-blue-900/50">
                    <Loader2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 animate-spin" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t('onlinePayment.paymentInProgress')}</p>
                    <p className="text-xs text-muted-foreground">{t('onlinePayment.paymentInProgressDescription')}</p>
                  </div>
                </div>
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                  {parseFloat(stripePendingPayment.amount).toFixed(2)}{currencySymbol}
                </span>
              </div>
            </div>
          )}

          {/* Stripe Payment Completed */}
          {stripeRentalPayment && (
            <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50">
                    <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t('onlinePayment.received')}</p>
                    <p className="text-xs text-muted-foreground">
                      {stripeRentalPayment.paidAt
                        ? formatStoreDate(new Date(stripeRentalPayment.paidAt), timezone, 'SHORT_DATE_AT_TIME')
                        : ''}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  +{parseFloat(stripeRentalPayment.amount).toFixed(2)}{currencySymbol}
                </span>
              </div>
            </div>
          )}

          {/* Rental Payment Row */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t('payment.rental')}</span>
              <span className="text-sm text-muted-foreground">
                {rentalPaid.toFixed(2)}{currencySymbol} / {rental.toFixed(2)}{currencySymbol}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Progress
                value={(rentalPaid / rental) * 100}
                className={cn(
                  'h-2 flex-1',
                  isRentalFullyPaid ? '[&>div]:bg-emerald-500' : '[&>div]:bg-amber-500'
                )}
              />
              {isRentalFullyPaid ? (
                <Badge
                  variant="secondary"
                  className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs px-2"
                >
                  <Check className="h-3 w-3 mr-1" />
                  {t('payment.paid')}
                </Badge>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Badge variant="error" className="font-mono text-xs">
                    -{rentalRemaining.toFixed(2)}{currencySymbol}
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger render={<Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => openPaymentModal('rental', rentalRemaining)}
                      />}>
                      <Plus className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>{t('payment.recordRental')}</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>

          {/* Deposit Section */}
          {deposit > 0 && (
            <div className="space-y-3 pt-3 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('payment.deposit')}</span>
                </div>
                <span className="text-sm font-medium">{deposit.toFixed(2)}{currencySymbol}</span>
              </div>

              {/* Deposit Collection Status */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'w-2 h-2 rounded-full',
                    isDepositFullyCollected ? 'bg-emerald-500' : 'bg-red-500'
                  )} />
                  <span className="text-sm text-muted-foreground">
                    {isDepositFullyCollected
                      ? `${t('payment.collected')}: ${depositCollected.toFixed(2)}${currencySymbol}`
                      : `${t('payment.toCollect')}: ${depositRemaining.toFixed(2)}${currencySymbol}`}
                  </span>
                </div>
                {!isDepositFullyCollected && (
                  <Tooltip>
                    <TooltipTrigger render={<Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => openPaymentModal('deposit', depositRemaining)}
                      />}>
                      <Plus className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>{t('payment.recordDeposit')}</TooltipContent>
                  </Tooltip>
                )}
              </div>

              {/* Deposit Return Status */}
              {depositCollected > 0 && (
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      'w-2 h-2 rounded-full',
                      isDepositFullyReturned ? 'bg-gray-400' : 'bg-blue-500'
                    )} />
                    <span className="text-sm text-muted-foreground">
                      {isDepositFullyReturned
                        ? t('payment.fullyReturned')
                        : `${t('payment.toReturn')}: ${depositToReturn.toFixed(2)}${currencySymbol}`}
                    </span>
                  </div>
                  {depositToReturn > 0 && (
                    <Tooltip>
                      <TooltipTrigger render={<Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950"
                          onClick={openDepositReturnModal}
                        />}>
                        <ArrowDownLeft className="h-3.5 w-3.5" />
                      </TooltipTrigger>
                      <TooltipContent>{t('payment.returnDeposit')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}

              {/* Empreinte Bancaire (Authorization) */}
              {(depositStatusVal === 'card_saved' || depositStatusVal === 'authorized') && (
                <div className={cn(
                  'p-3 rounded-lg border',
                  depositStatusVal === 'authorized' && !authorizationExpired
                    ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
                    : depositStatusVal === 'authorized' && authorizationExpired
                    ? 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20'
                    : 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20'
                )}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className={cn(
                        'h-4 w-4',
                        depositStatusVal === 'authorized' && !authorizationExpired
                          ? 'text-amber-600 dark:text-amber-400'
                          : depositStatusVal === 'authorized' && authorizationExpired
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-blue-600 dark:text-blue-400'
                      )} />
                      <span className="text-sm font-medium">
                        {depositStatusVal === 'authorized' ? t('deposit.status.authorized') : t('deposit.status.cardSaved')}
                      </span>
                    </div>
                    {paymentMethod && (
                      <span className="text-xs text-muted-foreground">
                        {CARD_BRANDS[paymentMethod.brand || ''] || paymentMethod.brand} ****{paymentMethod.last4}
                      </span>
                    )}
                  </div>

                  {depositStatusVal === 'authorized' && depositAuthorizationExpiresAt && (
                    <div className="space-y-2 mb-3">
                      <div className="flex items-center gap-2">
                        <Clock className={cn(
                          'h-3.5 w-3.5',
                          authorizationExpired ? 'text-red-500' : 'text-amber-500'
                        )} />
                        <span className={cn(
                          'text-xs',
                          authorizationExpired
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        )}>
                          {authorizationExpired
                            ? t('deposit.expired')
                            : t('deposit.expiresIn', { time: authorizationTimeRemaining ?? '' })}
                        </span>
                      </div>
                      {!authorizationExpired && (
                        <Progress value={getAuthorizationProgress()} className="h-1" />
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {depositStatusVal === 'card_saved' && (
                      <Button
                        onClick={handleCreateHold}
                        disabled={isLoading}
                        className="flex-1"
                      >
                        {isLoading ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                        )}
                        {t('deposit.createHold')}
                      </Button>
                    )}

                    {depositStatusVal === 'authorized' && !authorizationExpired && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => setReleaseDialogOpen(true)}
                          disabled={isLoading}
                          className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                        >
                          <Check className="mr-2 h-3.5 w-3.5" />
                          {t('deposit.release')}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setCaptureAmount(deposit.toFixed(2))
                            setCaptureModalOpen(true)
                          }}
                          disabled={isLoading}
                          className="flex-1 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          <Banknote className="mr-2 h-3.5 w-3.5" />
                          {t('deposit.capture')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Released/Captured status */}
              {depositStatusVal === 'released' && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
                  <Check className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm text-emerald-700 dark:text-emerald-400">
                    {t('deposit.releasedDescription')}
                  </span>
                </div>
              )}

              {depositStatusVal === 'captured' && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
                  <Banknote className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-red-700 dark:text-red-400">
                    {t('deposit.capturedDescription')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Damages row if any */}
          {damagesPaid > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium text-red-700 dark:text-red-400">
                  {t('payment.damages')}
                </span>
              </div>
              <Badge
                variant="secondary"
                className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-mono"
              >
                +{damagesPaid.toFixed(2)}{currencySymbol}
              </Badge>
            </div>
          )}

          {/* Damage button for finished reservations */}
          {isReservationFinished && depositToReturn > 0 && (
            <Button
              variant="outline"
              className="w-full text-xs border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
              onClick={() => setDamageModalOpen(true)}
            >
              <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
              {t('payment.recordDamage')}
            </Button>
          )}

          {/* Request Payment Button */}
          {stripeConfigured && (rentalRemaining >= 0.5 || (deposit > 0 && depositStatusVal !== 'authorized' && depositStatusVal !== 'captured')) && (
            <Button
              variant="outline"
              className="w-full text-xs border-primary/50 text-primary hover:bg-primary/5"
              onClick={() => setRequestPaymentModalOpen(true)}
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {t('payment.requestPayment')}
            </Button>
          )}

          {/* Payment History with Fade Effect */}
          {historyPayments.length > 0 && (
            <div className="pt-3 border-t">
              <button
                onClick={() => setHistoryExpanded(!historyExpanded)}
                className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
              >
                <span>{t('payment.history')} ({historyPayments.length})</span>
                {historyExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>

              <div className="relative">
                <div className="space-y-1.5">
                  {visiblePayments.map((payment, index) => (
                    <div
                      key={payment.id}
                      className={cn(
                        'flex items-center justify-between p-2 rounded-lg border bg-card text-xs transition-opacity',
                        payment.method === 'stripe' && 'border-l-2 border-l-[#635BFF]',
                        !historyExpanded && index === VISIBLE_HISTORY_COUNT - 1 && hasMorePayments && 'opacity-50'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          'flex items-center justify-center w-6 h-6 rounded-full',
                          payment.method === 'stripe' ? 'bg-[#635BFF]/10' : 'bg-muted'
                        )}>
                          {METHOD_ICONS[payment.method]}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{getTypeLabel(payment.type)}</span>
                            {payment.method === 'stripe' && (
                              <Badge
                                variant="secondary"
                                className="h-4 px-1 text-[9px] bg-[#635BFF]/10 text-[#635BFF] border-0"
                              >
                                Stripe
                              </Badge>
                            )}
                            {payment.status === 'authorized' && (
                              <Badge
                                variant="secondary"
                                className="h-4 px-1 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0"
                              >
                                {t('payment.statusAuthorized')}
                              </Badge>
                            )}
                            {payment.status === 'refunded' && (
                              <Badge
                                variant="secondary"
                                className="h-4 px-1 text-[9px] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-0"
                              >
                                {t('payment.statusRefunded')}
                              </Badge>
                            )}
                            {payment.status === 'cancelled' && (
                              <Badge
                                variant="secondary"
                                className="h-4 px-1 text-[9px] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-0"
                              >
                                {t('payment.statusCancelled')}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {payment.paidAt
                              ? formatStoreDate(new Date(payment.paidAt), timezone, 'TIMESTAMP')
                              : '-'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          'font-mono font-medium',
                          payment.type === 'deposit_return' && 'text-emerald-600 dark:text-emerald-400',
                          payment.type === 'damage' && 'text-red-600 dark:text-red-400',
                          payment.type === 'deposit_capture' && 'text-red-600 dark:text-red-400',
                          payment.type === 'adjustment' && parseFloat(payment.amount) < 0 && 'text-red-600 dark:text-red-400',
                          payment.type === 'adjustment' && parseFloat(payment.amount) > 0 && 'text-emerald-600 dark:text-emerald-400',
                          payment.status === 'cancelled' && 'text-muted-foreground line-through'
                        )}>
                          {payment.type === 'deposit_return' ? '-' :
                           payment.type === 'adjustment' ? (parseFloat(payment.amount) < 0 ? '' : '+') : '+'}
                          {parseFloat(payment.amount).toFixed(2)}{currencySymbol}
                        </span>
                        {payment.method !== 'stripe' && (
                          <Tooltip>
                            <TooltipTrigger render={<Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  setPaymentToDelete(payment)
                                  setDeleteDialogOpen(true)
                                }}
                              />}>
                              <Trash2 className="h-3 w-3" />
                            </TooltipTrigger>
                            <TooltipContent>{tCommon('delete')}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Fade overlay when collapsed and has more */}
                {!historyExpanded && hasMorePayments && (
                  <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent pointer-events-none" />
                )}
              </div>

              {hasMorePayments && !historyExpanded && (
                <Button
                  variant="ghost"
                  className="w-full mt-2 text-xs"
                  onClick={() => setHistoryExpanded(true)}
                >
                  {t('payment.showAll', { count: historyPayments.length })}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record Payment Modal */}
      <Dialog open={paymentModalOpen} onOpenChange={setPaymentModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('payment.recordPayment')}</DialogTitle>
            <DialogDescription>
              {paymentType === 'rental'
                ? t('payment.recordRentalDescription')
                : paymentType === 'adjustment'
                  ? t('payment.recordAdjustmentDescription')
                  : t('payment.recordDepositDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('payment.type')}</Label>
              <Select value={paymentType} onValueChange={(v) => { if (v !== null) setPaymentType(v as PaymentType) }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rental">{t('payment.types.rental')}</SelectItem>
                  <SelectItem value="deposit">{t('payment.types.deposit')}</SelectItem>
                  <SelectItem value="adjustment">{t('payment.types.adjustment')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('payment.amount')}</Label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  min={paymentType === 'adjustment' ? undefined : '0'}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder={paymentType === 'adjustment' ? '-0.00' : '0.00'}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {currencySymbol}
                </span>
              </div>
              {paymentType === 'adjustment' ? (
                <p className="text-xs text-muted-foreground">
                  {t('payment.adjustmentHint')}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {paymentType === 'rental'
                    ? t('payment.rentalRemaining', { formattedAmount: `${rentalRemaining.toFixed(2)}${currencySymbol}` })
                    : t('payment.depositRemaining', { formattedAmount: `${depositRemaining.toFixed(2)}${currencySymbol}` })}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('payment.method')}</Label>
              <Select value={paymentMethodType} onValueChange={(v) => { if (v !== null) setPaymentMethodType(v as PaymentMethod) }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t('payment.methods.cash')}</SelectItem>
                  <SelectItem value="card">{t('payment.methods.card')}</SelectItem>
                  <SelectItem value="transfer">{t('payment.methods.transfer')}</SelectItem>
                  <SelectItem value="check">{t('payment.methods.check')}</SelectItem>
                  <SelectItem value="other">{t('payment.methods.other')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                {t('payment.notes')}
                <span className="text-muted-foreground font-normal ml-1">
                  ({tCommon('optional')})
                </span>
              </Label>
              <Textarea
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder={t('payment.notesPlaceholder')}
                rows={2}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentModalOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleRecordPayment} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('payment.record')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return Deposit Modal */}
      <Dialog open={depositReturnModalOpen} onOpenChange={setDepositReturnModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('payment.returnDeposit')}</DialogTitle>
            <DialogDescription>
              {t('payment.returnDepositDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted space-y-2 text-sm">
              <div className="flex justify-between">
                <span>{t('payment.depositCollected')}</span>
                <span className="font-medium">{depositCollected.toFixed(2)}{currencySymbol}</span>
              </div>
              {depositReturned > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t('payment.alreadyReturned')}</span>
                  <span>-{depositReturned.toFixed(2)}{currencySymbol}</span>
                </div>
              )}
              {damagesPaid > 0 && (
                <div className="flex justify-between text-red-600 dark:text-red-400">
                  <span>{t('payment.damagesDeducted')}</span>
                  <span>-{damagesPaid.toFixed(2)}{currencySymbol}</span>
                </div>
              )}
              <div className="border-t pt-2 flex justify-between font-medium">
                <span>{t('payment.suggestedReturn')}</span>
                <span className="text-emerald-600 dark:text-emerald-400">{suggestedReturnAmount.toFixed(2)}{currencySymbol}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('payment.amountToReturn')}</Label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={depositToReturn}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {currencySymbol}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('payment.method')}</Label>
              <Select value={paymentMethodType} onValueChange={(v) => { if (v !== null) setPaymentMethodType(v as PaymentMethod) }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t('payment.methods.cash')}</SelectItem>
                  <SelectItem value="card">{t('payment.methods.card')}</SelectItem>
                  <SelectItem value="transfer">{t('payment.methods.transfer')}</SelectItem>
                  <SelectItem value="check">{t('payment.methods.check')}</SelectItem>
                  <SelectItem value="other">{t('payment.methods.other')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                {t('payment.notes')}
                <span className="text-muted-foreground font-normal ml-1">
                  ({tCommon('optional')})
                </span>
              </Label>
              <Textarea
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder={t('payment.returnNotesPlaceholder')}
                rows={2}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositReturnModalOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleReturnDeposit} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('payment.return')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Damage Modal */}
      <Dialog open={damageModalOpen} onOpenChange={setDamageModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('payment.recordDamage')}</DialogTitle>
            <DialogDescription>
              {t('payment.recordDamageDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('payment.damageAmount')}</Label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {currencySymbol}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('payment.method')}</Label>
              <Select value={paymentMethodType} onValueChange={(v) => { if (v !== null) setPaymentMethodType(v as PaymentMethod) }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t('payment.methods.cash')}</SelectItem>
                  <SelectItem value="card">{t('payment.methods.card')}</SelectItem>
                  <SelectItem value="transfer">{t('payment.methods.transfer')}</SelectItem>
                  <SelectItem value="check">{t('payment.methods.check')}</SelectItem>
                  <SelectItem value="other">{t('payment.methods.other')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                {t('payment.damageDescription')} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder={t('payment.damageNotesPlaceholder')}
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {t('payment.damageNotesHint')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDamageModalOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={handleRecordDamage}
              disabled={isLoading}
              variant="destructive"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('payment.recordDamage')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Payment Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('payment.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('payment.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{tCommon('cancel')}</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={handleDeletePayment}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon('delete')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Capture Deposit Modal */}
      <Dialog open={captureModalOpen} onOpenChange={setCaptureModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              {t('deposit.captureTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('deposit.captureDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('deposit.maxCapturable')}</span>
                <span className="font-medium">{deposit.toFixed(2)}{currencySymbol}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="captureAmount">{t('deposit.captureAmount')}</Label>
              <div className="relative">
                <Input
                  id="captureAmount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={deposit}
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

            <div className="space-y-2">
              <Label htmlFor="captureReason">
                {t('deposit.captureReason')} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="captureReason"
                value={captureReason}
                onChange={(e) => setCaptureReason(e.target.value)}
                placeholder={t('deposit.captureReasonPlaceholder')}
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {t('deposit.captureReasonHint')}
              </p>
            </div>
          </div>

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
              {t('deposit.confirmCapture')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release Deposit Confirmation */}
      <AlertDialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              {t('deposit.releaseTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('deposit.releaseDescription', { amount: `${deposit.toFixed(2)}${currencySymbol}` })}
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
              {t('deposit.confirmRelease')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Request Payment Modal */}
      <RequestPaymentModal
        open={requestPaymentModalOpen}
        onOpenChange={setRequestPaymentModalOpen}
        reservationId={reservationId}
        reservationNumber={reservationNumber}
        customer={customer}
        totalAmount={rental}
        paidAmount={rentalPaid}
        depositAmount={deposit}
        depositStatus={depositStatusVal}
        currency={currency}
        stripeConfigured={stripeConfigured}
      />
    </TooltipProvider>
  )
}
