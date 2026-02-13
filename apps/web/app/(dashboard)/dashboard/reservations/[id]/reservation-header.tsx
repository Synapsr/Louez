'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useTranslations } from 'next-intl'
import { env } from '@/env'
import {
  ArrowLeft,
  Building2,
  Mail,
  FileText,
  MoreHorizontal,
  Download,
  Printer,
  Copy,
  ExternalLink,
  Check,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Smartphone,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@louez/ui'
import { cn, getCurrencySymbol } from '@louez/utils'

import { PaymentStatusBadge } from './payment-status-badge'
import { SendEmailModal } from './send-email-modal'
import { UpgradeModal } from '@/components/dashboard/upgrade-modal'
import { orpc } from '@/lib/orpc/react'
import { invalidateReservationDetail } from '@/lib/orpc/invalidation'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

interface Customer {
  id: string
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  customerType?: 'individual' | 'business'
  companyName?: string | null
}

interface ReservationHeaderProps {
  reservationId: string
  reservationNumber: string
  status: ReservationStatus
  createdAt: Date
  startDate: Date
  endDate: Date
  customer: Customer
  storeSlug: string
  // Payment data
  rentalAmount: number
  rentalPaid: number
  depositAmount: number
  depositCollected: number
  depositReturned: number
  totalAmount: number
  // Optional
  sentEmails?: string[]
  hasContract?: boolean
  currency?: string
  // SMS
  smsConfigured?: boolean
}

const STATUS_CLASSES: Record<ReservationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  confirmed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  ongoing: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  completed: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
}

export function ReservationHeader({
  reservationId,
  reservationNumber,
  status,
  createdAt,
  startDate,
  endDate,
  customer,
  storeSlug,
  rentalAmount,
  rentalPaid,
  depositAmount,
  depositCollected,
  depositReturned,
  totalAmount,
  sentEmails = [],
  hasContract = false,
  currency = 'EUR',
  smsConfigured = false,
}: ReservationHeaderProps) {
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const currencySymbol = getCurrencySymbol(currency)
  const router = useRouter()
  const queryClient = useQueryClient()

  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [isSendingAccessLink, setIsSendingAccessLink] = useState(false)
  const [isSendingAccessLinkSms, setIsSendingAccessLinkSms] = useState(false)
  const [smsLimitModalOpen, setSmsLimitModalOpen] = useState(false)
  const [smsLimitInfo, setSmsLimitInfo] = useState<{
    current: number
    limit: number
    planSlug: string
  } | null>(null)

  const isFullyPaid = rentalPaid >= rentalAmount && (depositAmount === 0 || depositCollected >= depositAmount)
  const canEdit = !['completed', 'cancelled', 'rejected'].includes(status)

  const sendAccessLinkMutation = useMutation(
    orpc.dashboard.reservations.sendAccessLink.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationDetail(queryClient, reservationId)
      },
    }),
  )

  const sendAccessLinkSmsMutation = useMutation(
    orpc.dashboard.reservations.sendAccessLinkBySms.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationDetail(queryClient, reservationId)
      },
    }),
  )

  // Format date range
  const formatDateRange = () => {
    const start = format(startDate, 'd MMM', { locale: fr })
    const end = format(endDate, 'd MMM yyyy', { locale: fr })
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    return `${start} - ${end} (${days} ${days > 1 ? 'jours' : 'jour'})`
  }

  const handleCopyLink = () => {
    const domain = env.NEXT_PUBLIC_APP_DOMAIN
    const url = `https://${storeSlug}.${domain}/account/reservations/${reservationId}`
    navigator.clipboard.writeText(url)
    setCopiedLink(true)
    toastManager.add({ title: t('linkCopied'), type: 'success' })
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const handleSendAccessLink = async () => {
    setIsSendingAccessLink(true)
    try {
      await sendAccessLinkMutation.mutateAsync({ reservationId })
      toastManager.add({ title: t('accessLink.sendSuccess'), type: 'success' })
    } catch {
      toastManager.add({ title: t('accessLink.sendError'), type: 'error' })
    } finally {
      setIsSendingAccessLink(false)
    }
  }

  const handleSendAccessLinkSms = async () => {
    if (!customer.phone) {
      toastManager.add({ title: t('accessLink.noPhone'), type: 'error' })
      return
    }
    setIsSendingAccessLinkSms(true)
    try {
      const result = await sendAccessLinkSmsMutation.mutateAsync({ reservationId }) as {
        error?: string
        limitReached?: boolean
        limitInfo?: { current: number; limit: number; planSlug: string }
        success?: boolean
      }
      if (result.error) {
        // Handle SMS limit reached
        if (result.limitReached && result.limitInfo) {
          setSmsLimitInfo(result.limitInfo)
          setSmsLimitModalOpen(true)
        } else if (result.error === 'errors.customerNoPhone') {
          toastManager.add({ title: t('accessLink.noPhone'), type: 'error' })
        } else {
          toastManager.add({ title: t('accessLink.smsSendError'), type: 'error' })
        }
      } else {
        toastManager.add({ title: t('accessLink.smsSendSuccess'), type: 'success' })
      }
    } catch {
      toastManager.add({ title: t('accessLink.smsSendError'), type: 'error' })
    } finally {
      setIsSendingAccessLinkSms(false)
    }
  }

  const handleDownloadContract = () => {
    window.open(`/api/reservations/${reservationId}/contract`, '_blank')
  }

  return (
    <>
      <div className="flex flex-col gap-4 pb-6 border-b">
        {/* Top row: Back button + Title + Badges */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button
              render={<Link href="/dashboard/reservations" />}
              variant="ghost"
              size="icon"
              className="shrink-0 -ml-2 mt-0.5"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">{tCommon('back')}</span>
            </Button>

            <div className="space-y-1">
              {/* Reservation number + Status badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">
                  #{reservationNumber}
                </h1>
                <Badge
                  variant="outline"
                  className={cn('font-medium', STATUS_CLASSES[status])}
                >
                  {t(`status.${status}`)}
                </Badge>
                <PaymentStatusBadge
                  rentalAmount={rentalAmount}
                  rentalPaid={rentalPaid}
                  depositAmount={depositAmount}
                  depositCollected={depositCollected}
                  depositReturned={depositReturned}
                />
              </div>

              {/* Meta info */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                {customer.customerType === 'business' && customer.companyName ? (
                  <>
                    <span className="font-medium text-foreground inline-flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {customer.companyName}
                    </span>
                    <span className="text-muted-foreground">
                      {customer.firstName} {customer.lastName}
                    </span>
                  </>
                ) : (
                  <span className="font-medium text-foreground">
                    {customer.firstName} {customer.lastName}
                  </span>
                )}
                <span className="text-muted-foreground/50">•</span>
                <span>{formatDateRange()}</span>
                <span className="text-muted-foreground/50">•</span>
                <span className="font-medium text-foreground">
                  {totalAmount.toFixed(2)}{currencySymbol}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Email button */}
            <Button
              variant="outline"
              onClick={() => setEmailModalOpen(true)}
              className="hidden sm:flex"
            >
              <Mail className="h-4 w-4 mr-2" />
              {t('actions.sendEmail')}
            </Button>

            {/* Access Link button */}
            <Button
              variant="outline"
              onClick={handleSendAccessLink}
              disabled={isSendingAccessLink}
              className="hidden sm:flex"
            >
              {isSendingAccessLink ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <LinkIcon className="h-4 w-4 mr-2" />
              )}
              {t('accessLink.send')}
            </Button>

            {/* SMS Access Link button */}
            {smsConfigured && customer.phone && (
              <Button
                variant="outline"
                onClick={handleSendAccessLinkSms}
                disabled={isSendingAccessLinkSms}
                className="hidden sm:flex"
              >
                {isSendingAccessLinkSms ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Smartphone className="h-4 w-4 mr-2" />
                )}
                {t('accessLink.sendSms')}
              </Button>
            )}

            {/* Contract button */}
            {hasContract && (
              <Button
                variant="outline"
                onClick={handleDownloadContract}
                className="hidden sm:flex"
              >
                <FileText className="h-4 w-4 mr-2" />
                {t('contract.download')}
              </Button>
            )}

            {/* More actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-9 w-9" />}>
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">{tCommon('actions')}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {/* Mobile-only items */}
                <DropdownMenuItem
                  onClick={() => setEmailModalOpen(true)}
                  className="sm:hidden"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  {t('actions.sendEmail')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleSendAccessLink}
                  disabled={isSendingAccessLink}
                  className="sm:hidden"
                >
                  {isSendingAccessLink ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <LinkIcon className="h-4 w-4 mr-2" />
                  )}
                  {t('accessLink.send')}
                </DropdownMenuItem>
                {smsConfigured && customer.phone && (
                  <DropdownMenuItem
                    onClick={handleSendAccessLinkSms}
                    disabled={isSendingAccessLinkSms}
                    className="sm:hidden"
                  >
                    {isSendingAccessLinkSms ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Smartphone className="h-4 w-4 mr-2" />
                    )}
                    {t('accessLink.sendSms')}
                  </DropdownMenuItem>
                )}
                {hasContract && (
                  <DropdownMenuItem
                    onClick={handleDownloadContract}
                    className="sm:hidden"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    {t('contract.download')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator className="sm:hidden" />

                {/* Edit reservation */}
                {canEdit && (
                  <DropdownMenuItem onClick={() => router.push(`/dashboard/reservations/${reservationId}/edit`)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    {t('edit.button')}
                  </DropdownMenuItem>
                )}
                {canEdit && <DropdownMenuSeparator />}

                {/* Common items */}
                <DropdownMenuItem onClick={handleDownloadContract}>
                  <Download className="h-4 w-4 mr-2" />
                  {t('actions.downloadContract')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.print()}>
                  <Printer className="h-4 w-4 mr-2" />
                  {t('actions.print')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleCopyLink}>
                  {copiedLink ? (
                    <Check className="h-4 w-4 mr-2 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  {t('actions.copyLink')}
                </DropdownMenuItem>
                <DropdownMenuItem render={<a
                    href={`https://${storeSlug}.${env.NEXT_PUBLIC_APP_DOMAIN}/account/reservations/${reservationId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  />}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('actions.viewAsCustomer')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Created date - subtle */}
        <p className="text-xs text-muted-foreground pl-11">
          {t('createdAt')} {format(createdAt, 'PPP', { locale: fr })}
        </p>
      </div>

      {/* Email Modal */}
      <SendEmailModal
        open={emailModalOpen}
        onOpenChange={setEmailModalOpen}
        reservationId={reservationId}
        reservationNumber={reservationNumber}
        customer={customer}
        status={status}
        isFullyPaid={isFullyPaid}
        sentEmails={sentEmails}
      />

      {/* SMS Limit Upgrade Modal */}
      {smsLimitInfo && (
        <UpgradeModal
          open={smsLimitModalOpen}
          onOpenChange={setSmsLimitModalOpen}
          limitType="sms"
          currentCount={smsLimitInfo.current}
          limit={smsLimitInfo.limit}
          currentPlan={smsLimitInfo.planSlug}
        />
      )}
    </>
  )
}
