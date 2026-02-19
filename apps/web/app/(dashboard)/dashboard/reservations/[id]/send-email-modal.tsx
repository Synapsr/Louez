'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mail,
  FileText,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  Send,
  Loader2,
  Check,
  AlertCircle,
  MessageSquare,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
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
import { cn } from '@louez/utils'

import { orpc } from '@/lib/orpc/react'
import { invalidateReservationAll } from '@/lib/orpc/invalidation'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

interface Customer {
  id: string
  firstName: string
  lastName: string
  email: string
}

interface EmailTemplate {
  id: string
  icon: React.ReactNode
  iconBg: string
  available: (status: ReservationStatus, isFullyPaid: boolean) => boolean
}

const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'contract',
    icon: <FileText className="h-4 w-4" />,
    iconBg: 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400',
    available: (status) => ['confirmed', 'ongoing'].includes(status),
  },
  {
    id: 'payment_request',
    icon: <CreditCard className="h-4 w-4" />,
    iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400',
    available: (status, isFullyPaid) => !isFullyPaid && !['cancelled', 'rejected'].includes(status),
  },
  {
    id: 'reminder_pickup',
    icon: <ArrowUpRight className="h-4 w-4" />,
    iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400',
    available: (status) => status === 'confirmed',
  },
  {
    id: 'reminder_return',
    icon: <ArrowDownRight className="h-4 w-4" />,
    iconBg: 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400',
    available: (status) => status === 'ongoing',
  },
  {
    id: 'custom',
    icon: <MessageSquare className="h-4 w-4" />,
    iconBg: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    available: () => true,
  },
]

interface SendEmailModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reservationId: string
  reservationNumber: string
  customer: Customer
  status: ReservationStatus
  isFullyPaid: boolean
  sentEmails?: string[]
}

export function SendEmailModal({
  open,
  onOpenChange,
  reservationId,
  reservationNumber,
  customer,
  status,
  isFullyPaid,
  sentEmails = [],
}: SendEmailModalProps) {
  const t = useTranslations('dashboard.reservations.emailModal')
  const tCommon = useTranslations('common')
  const queryClient = useQueryClient()

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [customSubject, setCustomSubject] = useState('')
  const [customMessage, setCustomMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const sendEmailMutation = useMutation(
    orpc.dashboard.reservations.sendReservationEmail.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservationId)
      },
    }),
  )

  const availableTemplates = EMAIL_TEMPLATES.filter((template) =>
    template.available(status, isFullyPaid)
  )

  const handleSend = async () => {
    if (!selectedTemplate) {
      toastManager.add({ title: t('selectTemplateError'), type: 'error' })
      return
    }

    if (selectedTemplate === 'custom' && !customMessage.trim()) {
      toastManager.add({ title: t('customMessageRequired'), type: 'error' })
      return
    }

    setIsLoading(true)
    try {
      await sendEmailMutation.mutateAsync({
        reservationId,
        payload: {
          templateId: selectedTemplate,
          customSubject: customSubject || undefined,
          customMessage: customMessage || undefined,
        },
      })

      toastManager.add({ title: t('sendSuccess'), type: 'success' })
      onOpenChange(false)
      resetForm()
    } catch {
      toastManager.add({ title: t('sendError'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const resetForm = () => {
    setSelectedTemplate(null)
    setCustomSubject('')
    setCustomMessage('')
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm()
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {t('description', { name: customer.firstName, email: customer.email })}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
        <div className="space-y-4">
          {/* Email templates selection */}
          <div className="space-y-2">
            <Label>{t('selectTemplate')}</Label>
            <div className="grid gap-2">
              {availableTemplates.map((template) => {
                const wasSent = sentEmails.includes(template.id)
                const isSelected = selectedTemplate === template.id

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedTemplate(template.id)}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border text-left transition-all',
                      'hover:border-primary/50 hover:bg-muted/50',
                      isSelected && 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    )}
                  >
                    <div
                      className={cn(
                        'mt-0.5 p-2 rounded-lg shrink-0',
                        template.iconBg
                      )}
                    >
                      {template.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {t(`templates.${template.id}.name`)}
                        </span>
                        {wasSent && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          >
                            <Check className="h-2.5 w-2.5 mr-0.5" />
                            {t('alreadySent')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t(`templates.${template.id}.description`)}
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

          {/* Custom message fields */}
          {selectedTemplate === 'custom' && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="space-y-2">
                <Label htmlFor="subject">{t('customSubject')}</Label>
                <input
                  id="subject"
                  type="text"
                  value={customSubject}
                  onChange={(e) => setCustomSubject(e.target.value)}
                  placeholder={t('customSubjectPlaceholder', { number: reservationNumber })}
                  className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">
                  {t('customMessage')} <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="message"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder={t('customMessagePlaceholder')}
                  rows={4}
                  className="resize-none"
                />
              </div>
            </div>
          )}

          {/* Additional message for predefined templates */}
          {selectedTemplate && selectedTemplate !== 'custom' && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              <Label htmlFor="additional-message">
                {t('additionalMessage')}
                <span className="text-muted-foreground font-normal ml-1">
                  ({tCommon('other').toLowerCase()})
                </span>
              </Label>
              <Textarea
                id="additional-message"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder={t('additionalMessagePlaceholder')}
                rows={2}
                className="resize-none"
              />
            </div>
          )}

          {/* Info message */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-sm">
            <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              {t('emailWillBeSentTo', { email: customer.email })}
            </p>
          </div>
        </div>
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
            onClick={handleSend}
            disabled={isLoading || !selectedTemplate}
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
