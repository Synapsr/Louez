'use client'

import { useState } from 'react'
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
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
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
  AlertDialogAction,
  AlertDialogCancel,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@louez/ui'
import { Input } from '@louez/ui'
import { Label } from '@louez/ui'
import { Textarea } from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { cn, getCurrencySymbol } from '@louez/utils'

import {
  recordPayment,
  deletePayment,
  returnDeposit,
  recordDamage,
  type PaymentType,
  type PaymentMethod,
} from '../actions'

interface Payment {
  id: string
  amount: string
  type: 'rental' | 'deposit' | 'deposit_return' | 'damage' | 'deposit_hold' | 'deposit_capture' | 'adjustment'
  method: 'stripe' | 'cash' | 'card' | 'transfer' | 'check' | 'other'
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'authorized' | 'cancelled'
  paidAt: Date | null
  notes: string | null
}

interface PaymentSummaryProps {
  reservationId: string
  subtotalAmount: string
  depositAmount: string
  totalAmount: string
  payments: Payment[]
  status: string
  currency?: string
}

const METHOD_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote className="h-3.5 w-3.5" />,
  card: <CreditCard className="h-3.5 w-3.5" />,
  transfer: <Building2 className="h-3.5 w-3.5" />,
  check: <Receipt className="h-3.5 w-3.5" />,
  stripe: <CreditCard className="h-3.5 w-3.5 text-[#635BFF]" />,
  other: <Wallet className="h-3.5 w-3.5" />,
}

export function PaymentSummary({
  reservationId,
  subtotalAmount,
  depositAmount,
  totalAmount,
  payments,
  status,
  currency = 'EUR',
}: PaymentSummaryProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const currencySymbol = getCurrencySymbol(currency)

  const [isLoading, setIsLoading] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [depositReturnModalOpen, setDepositReturnModalOpen] = useState(false)
  const [damageModalOpen, setDamageModalOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Form state
  const [paymentType, setPaymentType] = useState<PaymentType>('rental')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [paymentNotes, setPaymentNotes] = useState('')

  // Calculate totals
  const rental = parseFloat(subtotalAmount)
  const deposit = parseFloat(depositAmount)

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

  const resetForm = () => {
    setPaymentAmount('')
    setPaymentMethod('cash')
    setPaymentNotes('')
  }

  const handleRecordPayment = async () => {
    const amount = parseFloat(paymentAmount)
    if (isNaN(amount) || amount === 0) {
      toast.error(t('payment.invalidAmount'))
      return
    }
    // Only adjustment type can have negative amounts
    if (amount < 0 && paymentType !== 'adjustment') {
      toast.error(t('payment.negativeAmountOnlyForAdjustment'))
      return
    }

    setIsLoading(true)
    try {
      const result = await recordPayment(reservationId, {
        type: paymentType,
        amount,
        method: paymentMethod,
        notes: paymentNotes || undefined,
      })

      if (result.error) {
        toast.error(tErrors(result.error))
      } else {
        toast.success(t('payment.recorded'))
        setPaymentModalOpen(false)
        resetForm()
        router.refresh()
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleReturnDeposit = async () => {
    const amount = parseFloat(paymentAmount)
    if (isNaN(amount) || amount <= 0) {
      toast.error(t('payment.invalidAmount'))
      return
    }

    if (amount > depositToReturn) {
      toast.error(t('payment.amountExceedsDeposit'))
      return
    }

    setIsLoading(true)
    try {
      const result = await returnDeposit(reservationId, {
        amount,
        method: paymentMethod,
        notes: paymentNotes || undefined,
      })

      if (result.error) {
        toast.error(tErrors(result.error))
      } else {
        toast.success(t('payment.depositReturned'))
        setDepositReturnModalOpen(false)
        resetForm()
        router.refresh()
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleRecordDamage = async () => {
    const amount = parseFloat(paymentAmount)
    if (isNaN(amount) || amount <= 0) {
      toast.error(t('payment.invalidAmount'))
      return
    }

    if (!paymentNotes.trim()) {
      toast.error(t('payment.damageNotesRequired'))
      return
    }

    setIsLoading(true)
    try {
      const result = await recordDamage(reservationId, {
        amount,
        method: paymentMethod,
        notes: paymentNotes,
      })

      if (result.error) {
        toast.error(tErrors(result.error))
      } else {
        toast.success(t('payment.damageRecorded'))
        setDamageModalOpen(false)
        resetForm()
        router.refresh()
      }
    } catch {
      toast.error(tErrors('generic'))
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
        toast.error(tErrors(result.error))
      } else {
        toast.success(t('payment.deleted'))
        setDeleteDialogOpen(false)
        setPaymentToDelete(null)
        router.refresh()
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const openPaymentModal = (type: PaymentType, suggestedAmount?: number) => {
    setPaymentType(type)
    setPaymentAmount(suggestedAmount?.toFixed(2) || '')
    setPaymentModalOpen(true)
  }

  // Calculate suggested return amount (accounting for damages)
  const suggestedReturnAmount = Math.max(0, depositToReturn - damagesPaid)

  const openDepositReturnModal = () => {
    // Pre-fill with suggested amount (deposit minus damages if any)
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

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            {t('payment.title')}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Rental payment row */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2.5">
              <div className={cn(
                'w-2 h-2 rounded-full shrink-0',
                isRentalFullyPaid ? 'bg-emerald-500' : 'bg-red-500'
              )} />
              <div>
                <p className="text-sm font-medium">{t('payment.rental')}</p>
                <p className="text-xs text-muted-foreground">
                  {rentalPaid.toFixed(2)}{currencySymbol} / {rental.toFixed(2)}{currencySymbol}
                </p>
              </div>
            </div>
            {isRentalFullyPaid ? (
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              >
                <Check className="h-3 w-3 mr-1" />
                {t('payment.paid')}
              </Badge>
            ) : (
              <div className="flex items-center gap-1.5">
                <Badge variant="destructive" className="font-mono text-xs">
                  -{rentalRemaining.toFixed(2)}{currencySymbol}
                </Badge>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => openPaymentModal('rental', rentalRemaining)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('payment.recordRental')}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>

          {/* Deposit row */}
          {deposit > 0 && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  isDepositFullyReturned
                    ? 'bg-gray-400'
                    : isDepositFullyCollected
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                )} />
                <div>
                  <p className="text-sm font-medium">{t('payment.deposit')}</p>
                  <p className="text-xs text-muted-foreground">
                    {depositCollected.toFixed(2)}{currencySymbol} {t('payment.collected')}
                    {depositReturned > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {' '}• {depositReturned.toFixed(2)}{currencySymbol} {t('payment.returned')}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {!isDepositFullyCollected ? (
                  <>
                    <Badge variant="destructive" className="font-mono text-xs">
                      -{depositRemaining.toFixed(2)}{currencySymbol}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={() => openPaymentModal('deposit', depositRemaining)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('payment.recordDeposit')}</TooltipContent>
                    </Tooltip>
                  </>
                ) : depositToReturn > 0 ? (
                  <>
                    <Badge
                      variant="secondary"
                      className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-mono text-xs"
                    >
                      {depositToReturn.toFixed(2)}{currencySymbol}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950"
                          onClick={openDepositReturnModal}
                        >
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('payment.returnDeposit')}</TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  >
                    <Check className="h-3 w-3 mr-1" />
                    {t('payment.depositReturned')}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Damages row if any */}
          {damagesPaid > 0 && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 dark:bg-red-950/20">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    {t('payment.damages')}
                  </p>
                  <p className="text-xs text-red-600/70 dark:text-red-400/70">
                    {t('payment.damagesCollected')}
                  </p>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-mono"
              >
                +{damagesPaid.toFixed(2)}{currencySymbol}
              </Badge>
            </div>
          )}

          {/* Global status message */}
          {!isRentalFullyPaid || (deposit > 0 && !isDepositFullyCollected) ? (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-400">
                {t('payment.unpaidWarning', {
                  formattedAmount: `${(rentalRemaining + depositRemaining).toFixed(2)}${currencySymbol}`,
                })}
              </p>
            </div>
          ) : isRentalFullyPaid && isDepositFullyCollected && (!deposit || isDepositFullyReturned) ? (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t('payment.allPaid')}
              </p>
            </div>
          ) : null}

          {/* Damage button for finished reservations */}
          {isReservationFinished && depositToReturn > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
              onClick={() => setDamageModalOpen(true)}
            >
              <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
              {t('payment.recordDamage')}
            </Button>
          )}

          {/* Payment history collapsible */}
          {payments.length > 0 && (
            <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between text-xs text-muted-foreground hover:text-foreground"
                >
                  {t('payment.history')} ({payments.length})
                  {historyOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 mt-2">
                {payments.map((payment) => (
                  <div
                    key={payment.id}
                    className={cn(
                      'flex items-center justify-between p-2 rounded-lg border bg-card text-xs',
                      payment.method === 'stripe' && 'border-l-2 border-l-[#635BFF]'
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
                            ? format(new Date(payment.paidAt), 'dd/MM/yy HH:mm', { locale: fr })
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
                        {payment.type === 'adjustment'
                          ? parseFloat(payment.amount).toFixed(2)
                          : parseFloat(payment.amount).toFixed(2)}{currencySymbol}
                      </span>
                      {payment.method !== 'stripe' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setPaymentToDelete(payment)
                                setDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{tCommon('delete')}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
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
              <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
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
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
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
                  ({tCommon('other').toLowerCase()})
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
            {/* Deposit breakdown */}
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
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
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
                  ({tCommon('other').toLowerCase()})
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
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
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
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePayment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}
