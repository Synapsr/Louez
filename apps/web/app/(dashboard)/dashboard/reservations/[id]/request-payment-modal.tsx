'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  CreditCard,
  Shield,
  Loader2,
  Send,
  Mail,
  MessageSquare,
  Copy,
  Check,
  AlertCircle,
  Receipt,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import {
  Dialog,
  DialogPopup,
  DialogPanel,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { Label } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Input } from '@louez/ui'
import { Checkbox } from '@louez/ui'
import { cn, formatCurrency } from '@louez/utils'

import { requestPayment, type RequestPaymentInput } from '../actions'

interface RequestPaymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reservationId: string
  reservationNumber: string
  customer: {
    firstName: string
    email: string
    phone?: string | null
  }
  totalAmount: number
  paidAmount: number
  depositAmount: number
  depositStatus?: string | null
  currency: string
  stripeConfigured: boolean
}

type PaymentType = 'rental' | 'deposit' | 'custom'

export function RequestPaymentModal({
  open,
  onOpenChange,
  reservationId,
  reservationNumber,
  customer,
  totalAmount,
  paidAmount,
  depositAmount,
  depositStatus,
  currency,
  stripeConfigured,
}: RequestPaymentModalProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.reservations.requestPaymentModal')
  const tCommon = useTranslations('common')

  const [selectedType, setSelectedType] = useState<PaymentType | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
  const [sendSms, setSendSms] = useState(false)
  const [customMessage, setCustomMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const remainingRental = totalAmount - paidAmount
  const canRequestDeposit = depositAmount > 0 && depositStatus !== 'held' && depositStatus !== 'captured'
  const canRequestRental = remainingRental >= 0.5
  const hasPhone = !!customer.phone

  const paymentTypes = useMemo(() => {
    const types: Array<{
      id: PaymentType
      icon: React.ReactNode
      iconBg: string
      available: boolean
      amount?: number
    }> = []

    if (canRequestRental) {
      types.push({
        id: 'rental',
        icon: <Receipt className="h-4 w-4" />,
        iconBg: 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400',
        available: true,
        amount: remainingRental,
      })
    }

    if (canRequestDeposit) {
      types.push({
        id: 'deposit',
        icon: <Shield className="h-4 w-4" />,
        iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400',
        available: true,
        amount: depositAmount,
      })
    }

    types.push({
      id: 'custom',
      icon: <CreditCard className="h-4 w-4" />,
      iconBg: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
      available: true,
    })

    return types
  }, [canRequestRental, canRequestDeposit, remainingRental, depositAmount])

  const selectedAmount = useMemo(() => {
    if (selectedType === 'rental') return remainingRental
    if (selectedType === 'deposit') return depositAmount
    if (selectedType === 'custom') {
      const parsed = parseFloat(customAmount)
      return isNaN(parsed) ? 0 : parsed
    }
    return 0
  }, [selectedType, customAmount, remainingRental, depositAmount])

  const isValidAmount = selectedAmount >= 0.5
  const hasChannel = sendEmail || sendSms
  const canSubmit = selectedType && isValidAmount && hasChannel && stripeConfigured

  const handleSubmit = async () => {
    if (!canSubmit) return

    setIsLoading(true)
    try {
      const data: RequestPaymentInput = {
        type: selectedType,
        channels: { email: sendEmail, sms: sendSms },
        customMessage: customMessage || undefined,
      }

      if (selectedType === 'custom') {
        data.amount = selectedAmount
      }

      const result = await requestPayment(reservationId, data)

      if (result.error) {
        toastManager.add({ title: t('error'), type: 'error' })
      } else {
        toastManager.add({ title: t('success'), type: 'success' })
        if (result.paymentUrl) {
          setPaymentUrl(result.paymentUrl)
        }
        router.refresh()
      }
    } catch {
      toastManager.add({ title: t('error'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopyLink = async () => {
    if (!paymentUrl) return
    try {
      await navigator.clipboard.writeText(paymentUrl)
      setCopied(true)
      toastManager.add({ title: t('linkCopied'), type: 'success' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toastManager.add({ title: t('copyFailed'), type: 'error' })
    }
  }

  const resetForm = () => {
    setSelectedType(null)
    setCustomAmount('')
    setSendEmail(true)
    setSendSms(false)
    setCustomMessage('')
    setPaymentUrl(null)
    setCopied(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm()
    }
    onOpenChange(newOpen)
  }

  // Success view after sending
  if (paymentUrl) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" />
              {t('successTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('successDescription', {
                channel: sendEmail && sendSms ? 'email et SMS' : sendEmail ? 'email' : 'SMS',
              })}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50 text-sm">
              <Label className="text-xs text-muted-foreground mb-2 block">
                {t('paymentLink')}
              </Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs break-all font-mono bg-background p-2 rounded border">
                  {paymentUrl}
                </code>
                <Button
                  variant="outline"
                  onClick={handleCopyLink}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          </DialogPanel>

          <DialogFooter>
            <Button onClick={() => handleOpenChange(false)}>
              {tCommon('close')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {t('description', { name: customer.firstName })}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
        {!stripeConfigured ? (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {t('stripeNotConfigured')}
              </p>
              <p className="text-amber-700 dark:text-amber-300 mt-1">
                {t('stripeNotConfiguredDescription')}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Payment type selection */}
            <div className="space-y-2">
              <Label>{t('paymentType')}</Label>
              <div className="grid gap-2">
                {paymentTypes.map((type) => {
                  const isSelected = selectedType === type.id

                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setSelectedType(type.id)}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-lg border text-left transition-all',
                        'hover:border-primary/50 hover:bg-muted/50',
                        isSelected && 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      )}
                    >
                      <div
                        className={cn(
                          'mt-0.5 p-2 rounded-lg shrink-0',
                          type.iconBg
                        )}
                      >
                        {type.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm">
                            {t(`types.${type.id}.name`)}
                          </span>
                          {type.amount && (
                            <span className="text-sm font-semibold">
                              {formatCurrency(type.amount, currency)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t(`types.${type.id}.description`)}
                        </p>
                      </div>
                      <div
                        className={cn(
                          'w-4 h-4 rounded-full border-2 shrink-0 mt-1 transition-colors',
                          isSelected
                            ? 'border-primary bg-primary'
                            : 'border-muted-foreground/30'
                        )}
                      >
                        {isSelected && (
                          <Check className="h-full w-full p-0.5 text-primary-foreground" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Custom amount input */}
            {selectedType === 'custom' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <Label htmlFor="amount">{t('customAmount')}</Label>
                <div className="relative">
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.50"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="0.00"
                    className="pr-12"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {currency}
                  </span>
                </div>
                {customAmount && !isValidAmount && (
                  <p className="text-xs text-destructive">
                    {t('minAmount', { amount: formatCurrency(0.5, currency) })}
                  </p>
                )}
              </div>
            )}

            {/* Send via channels */}
            {selectedType && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <Label>{t('sendVia')}</Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="email"
                      checked={sendEmail}
                      onCheckedChange={(checked) => setSendEmail(!!checked)}
                    />
                    <label
                      htmlFor="email"
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      {t('email')}
                      <span className="text-muted-foreground">({customer.email})</span>
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="sms"
                      checked={sendSms}
                      onCheckedChange={(checked) => setSendSms(!!checked)}
                      disabled={!hasPhone}
                    />
                    <label
                      htmlFor="sms"
                      className={cn(
                        'flex items-center gap-2 text-sm cursor-pointer',
                        !hasPhone && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      {t('sms')}
                      {hasPhone ? (
                        <span className="text-muted-foreground">({customer.phone})</span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          ({t('noPhone')})
                        </span>
                      )}
                    </label>
                  </div>
                </div>
                {!hasChannel && (
                  <p className="text-xs text-destructive">{t('selectChannel')}</p>
                )}
              </div>
            )}

            {/* Custom message */}
            {selectedType && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <Label htmlFor="message">
                  {t('customMessage')}
                  <span className="text-muted-foreground font-normal ml-1">
                    ({tCommon('other').toLowerCase()})
                  </span>
                </Label>
                <Textarea
                  id="message"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder={t('customMessagePlaceholder')}
                  rows={2}
                  className="resize-none"
                />
              </div>
            )}

            {/* Summary */}
            {selectedType && isValidAmount && (
              <div className="p-3 rounded-lg bg-muted/50 text-sm animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('amountToRequest')}</span>
                  <span className="font-semibold text-lg">
                    {formatCurrency(selectedAmount, currency)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
        </DialogPanel>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            {tCommon('cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || isLoading}
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {t('send')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
