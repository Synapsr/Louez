'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft,
  Mail,
  FileText,
  MoreHorizontal,
  Download,
  Printer,
  Copy,
  ExternalLink,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, getCurrencySymbol } from '@/lib/utils'

import { PaymentStatusBadge } from './payment-status-badge'
import { SendEmailModal } from './send-email-modal'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

interface Customer {
  id: string
  firstName: string
  lastName: string
  email: string
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
}: ReservationHeaderProps) {
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')
  const currencySymbol = getCurrencySymbol(currency)

  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  const isFullyPaid = rentalPaid >= rentalAmount && (depositAmount === 0 || depositCollected >= depositAmount)

  // Format date range
  const formatDateRange = () => {
    const start = format(startDate, 'd MMM', { locale: fr })
    const end = format(endDate, 'd MMM yyyy', { locale: fr })
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    return `${start} - ${end} (${days} ${days > 1 ? 'jours' : 'jour'})`
  }

  const handleCopyLink = () => {
    const url = `${window.location.origin}/${storeSlug}/account/reservations/${reservationId}`
    navigator.clipboard.writeText(url)
    setCopiedLink(true)
    toast.success(t('linkCopied'))
    setTimeout(() => setCopiedLink(false), 2000)
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
              variant="ghost"
              size="icon"
              className="shrink-0 -ml-2 mt-0.5"
              asChild
            >
              <Link href="/dashboard/reservations">
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">{tCommon('back')}</span>
              </Link>
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
                <span className="font-medium text-foreground">
                  {customer.firstName} {customer.lastName}
                </span>
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
              size="sm"
              onClick={() => setEmailModalOpen(true)}
              className="hidden sm:flex"
            >
              <Mail className="h-4 w-4 mr-2" />
              {t('actions.sendEmail')}
            </Button>

            {/* Contract button */}
            {hasContract && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadContract}
                className="hidden sm:flex"
              >
                <FileText className="h-4 w-4 mr-2" />
                {t('contract.download')}
              </Button>
            )}

            {/* More actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">{tCommon('actions')}</span>
                </Button>
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
                <DropdownMenuItem asChild>
                  <Link
                    href={`/${storeSlug}/account/reservations/${reservationId}`}
                    target="_blank"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t('actions.viewAsCustomer')}
                  </Link>
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
    </>
  )
}
