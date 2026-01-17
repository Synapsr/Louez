import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { stores, reservations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  ArrowLeft,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Package,
  MapPin,
  Phone,
  Mail,
  ImageIcon,
  FileText,
  ArrowRight,
  CircleDot,
  CreditCard,
  AlertCircle,
  History,
  Banknote,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { formatCurrency } from '@/lib/utils'
import type { StoreSettings } from '@/types/store'
import { getCustomerSession } from '../../actions'
import { DownloadContractButton } from './download-contract-button'
import { PayNowButton } from './pay-now-button'

interface ReservationDetailPageProps {
  params: Promise<{ slug: string; reservationId: string }>
}

export default async function ReservationDetailPage({
  params,
}: ReservationDetailPageProps) {
  const { slug, reservationId } = await params
  const t = await getTranslations('storefront.account')
  const tCart = await getTranslations('storefront.cart')

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  const storeSettings = (store.settings as StoreSettings) || {}
  const currency = storeSettings.currency || 'EUR'

  const session = await getCustomerSession(slug)

  if (!session) {
    redirect('/account/login')
  }

  type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

  const statusConfig: Record<ReservationStatus, {
    label: string
    description: string
    variant: 'secondary' | 'default' | 'outline' | 'destructive'
    icon: typeof Clock
    color: string
    bgColor: string
    borderColor: string
  }> = {
    pending: {
      label: t('status.pendingFull'),
      description: t('status.pendingDescription'),
      variant: 'secondary',
      icon: Clock,
      color: 'text-amber-600 dark:text-amber-400',
      bgColor: 'bg-amber-100 dark:bg-amber-950/50',
      borderColor: 'border-amber-200 dark:border-amber-800',
    },
    confirmed: {
      label: t('status.confirmed'),
      description: t('status.confirmedDescription'),
      variant: 'default',
      icon: CheckCircle,
      color: 'text-emerald-600 dark:text-emerald-400',
      bgColor: 'bg-emerald-100 dark:bg-emerald-950/50',
      borderColor: 'border-emerald-200 dark:border-emerald-800',
    },
    ongoing: {
      label: t('status.ongoing'),
      description: t('status.ongoingDescription'),
      variant: 'default',
      icon: Package,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-100 dark:bg-blue-950/50',
      borderColor: 'border-blue-200 dark:border-blue-800',
    },
    completed: {
      label: t('status.completed'),
      description: t('status.completedDescription'),
      variant: 'outline',
      icon: CheckCircle,
      color: 'text-gray-600 dark:text-gray-400',
      bgColor: 'bg-gray-100 dark:bg-gray-950/50',
      borderColor: 'border-gray-200 dark:border-gray-700',
    },
    cancelled: {
      label: t('status.cancelled'),
      description: t('status.cancelledDescription'),
      variant: 'destructive',
      icon: XCircle,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-100 dark:bg-red-950/50',
      borderColor: 'border-red-200 dark:border-red-800',
    },
    rejected: {
      label: t('status.rejected'),
      description: t('status.rejectedDescription'),
      variant: 'destructive',
      icon: XCircle,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-100 dark:bg-red-950/50',
      borderColor: 'border-red-200 dark:border-red-800',
    },
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId)
    ),
    with: {
      items: true,
      payments: true,
    },
  })

  if (!reservation) {
    notFound()
  }

  const config = statusConfig[reservation.status as ReservationStatus]
  const StatusIcon = config.icon

  // Contract download available for confirmed, ongoing, completed
  const canDownloadContract = ['confirmed', 'ongoing', 'completed'].includes(reservation.status as ReservationStatus)

  // Check payment status - consider paid if any rental payment is completed
  const isPaid = reservation.payments.some((p) => p.type === 'rental' && p.status === 'completed')
  const totalPaid = reservation.payments
    .filter((p) => p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  // Check if payment button should be shown
  // Only allow payment for confirmed or ongoing reservations (not pending - store must accept first)
  const hasPendingPayment = reservation.payments.some((p) => p.type === 'rental' && p.status === 'pending')
  const isAccepted = reservation.status === 'confirmed' || reservation.status === 'ongoing'
  const canPay = isAccepted && !isPaid && !hasPendingPayment && store.stripeAccountId && store.stripeChargesEnabled

  // Show payment required warning when confirmed but not paid
  const showPaymentRequired = reservation.status === 'confirmed' && !isPaid && canPay

  // When confirmed and paid, show a positive message
  const isConfirmedAndPaid = reservation.status === 'confirmed' && isPaid

  return (
    <div className="min-h-[calc(100vh-200px)] bg-gradient-to-b from-muted/30 to-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Back Button */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="gap-2 -ml-2 text-muted-foreground hover:text-foreground">
            <Link href="/account">
              <ArrowLeft className="h-4 w-4" />
              {t('backToAccount')}
            </Link>
          </Button>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl sm:text-3xl font-bold">
                {t('reservationNumber', { number: reservation.number })}
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('createdAt', { date: format(reservation.createdAt, 'dd MMMM yyyy', { locale: fr }) })}
            </p>
          </div>
          {canDownloadContract && (
            <DownloadContractButton
              href={`/account/reservations/${reservationId}/contract`}
              label={t('downloadContract')}
            />
          )}
        </div>

        {/* Status Card */}
        <Card className={`mb-6 border-l-4 ${showPaymentRequired ? 'border-amber-400 dark:border-amber-600' : isConfirmedAndPaid ? 'border-emerald-400 dark:border-emerald-600' : config.borderColor}`}>
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-4 flex-1">
                <div className={`flex h-12 w-12 items-center justify-center rounded-full flex-shrink-0 ${showPaymentRequired ? 'bg-amber-100 dark:bg-amber-950/50' : isConfirmedAndPaid ? 'bg-emerald-100 dark:bg-emerald-950/50' : config.bgColor}`}>
                  {showPaymentRequired ? (
                    <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                  ) : isConfirmedAndPaid ? (
                    <CheckCircle className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <StatusIcon className={`h-6 w-6 ${config.color}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className={`font-semibold text-lg ${showPaymentRequired ? 'text-amber-600 dark:text-amber-400' : isConfirmedAndPaid ? 'text-emerald-600 dark:text-emerald-400' : config.color}`}>
                      {isConfirmedAndPaid ? t('status.allSet') : config.label}
                    </h3>
                    {showPaymentRequired && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 gap-1">
                        <CreditCard className="h-3 w-3" />
                        {t('confirmedAwaitingPayment')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {showPaymentRequired
                      ? t('paymentRequired')
                      : isConfirmedAndPaid
                        ? t('status.allSetDescription')
                        : config.description}
                  </p>
                </div>
              </div>
              {/* Pay Button side-by-side on larger screens */}
              {showPaymentRequired && (
                <div className="sm:flex-shrink-0">
                  <PayNowButton storeSlug={slug} reservationId={reservationId} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Rental Period */}
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Calendar className="h-5 w-5 text-primary" />
              {t('rentalPeriod')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Date Range Display */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <div className="flex-1 p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10">
                <div className="flex items-center gap-2 text-xs font-medium text-primary mb-2">
                  <CircleDot className="h-3 w-3" />
                  {t('start')}
                </div>
                <p className="font-semibold text-lg">
                  {format(reservation.startDate, 'EEEE dd MMMM', { locale: fr })}
                </p>
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {format(reservation.startDate, 'HH:mm', { locale: fr })}
                </p>
              </div>

              <div className="hidden sm:flex items-center justify-center">
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="flex-1 p-4 rounded-xl bg-muted/50 border">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                  <CircleDot className="h-3 w-3" />
                  {t('end')}
                </div>
                <p className="font-semibold text-lg">
                  {format(reservation.endDate, 'EEEE dd MMMM', { locale: fr })}
                </p>
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {format(reservation.endDate, 'HH:mm', { locale: fr })}
                </p>
              </div>
            </div>

            {/* Tracking info */}
            {(reservation.pickedUpAt || reservation.returnedAt) && (
              <div className="mt-5 pt-5 border-t">
                <div className="grid sm:grid-cols-2 gap-3">
                  {reservation.pickedUpAt && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300">
                      <CheckCircle className="h-5 w-5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide opacity-80">{t('pickedUpAt')}</p>
                        <p className="font-medium">
                          {format(reservation.pickedUpAt, 'dd/MM/yyyy HH:mm', { locale: fr })}
                        </p>
                      </div>
                    </div>
                  )}
                  {reservation.returnedAt && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300">
                      <CheckCircle className="h-5 w-5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide opacity-80">{t('returnedAt')}</p>
                        <p className="font-medium">
                          {format(reservation.returnedAt, 'dd/MM/yyyy HH:mm', { locale: fr })}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Items */}
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-base font-semibold">
                <Package className="h-5 w-5 text-primary" />
                {t('rentedItems')}
              </span>
              {/* Payment Status Badge */}
              <Badge
                variant={isPaid ? 'default' : 'secondary'}
                className={`gap-1.5 ${isPaid ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-400'}`}
              >
                <CreditCard className="h-3.5 w-3.5" />
                {isPaid ? t('paymentPaid') : t('paymentPending')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-4">
              {reservation.items.map((item) => (
                <div key={item.id} className="flex gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                  <div className="relative h-20 w-20 flex-shrink-0 rounded-lg overflow-hidden bg-background border">
                    {item.productSnapshot.images?.[0] ? (
                      <Image
                        src={item.productSnapshot.images[0]}
                        alt={item.productSnapshot.name}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-base">{item.productSnapshot.name}</h4>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                      <span>{t('quantityLabel')}: {item.quantity}</span>
                      <span>{formatCurrency(parseFloat(item.unitPrice), currency)} {t('unitPrice')}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold text-base">
                      {formatCurrency(parseFloat(item.totalPrice), currency)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <Separator className="my-5" />

            {/* Totals */}
            <div className="space-y-3 max-w-xs ml-auto">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('subtotalRental')}</span>
                <span>{formatCurrency(parseFloat(reservation.subtotalAmount), currency)}</span>
              </div>
              {parseFloat(reservation.depositAmount) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tCart('deposit')}</span>
                  <span>{formatCurrency(parseFloat(reservation.depositAmount), currency)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between font-semibold text-lg pt-1">
                <span>{tCart('total')}</span>
                <span className="text-primary">{formatCurrency(parseFloat(reservation.totalAmount), currency)}</span>
              </div>
              {/* Show paid amount if partially or fully paid */}
              {totalPaid > 0 && (
                <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3.5 w-3.5" />
                    {t('amountPaid')}
                  </span>
                  <span>{formatCurrency(totalPaid, currency)}</span>
                </div>
              )}

              {/* Pay Now Button */}
              {canPay && (
                <div className="pt-4 mt-2">
                  <PayNowButton storeSlug={slug} reservationId={reservationId} />
                </div>
              )}

              {/* Payment in progress indicator */}
              {hasPendingPayment && (
                <div className="flex justify-between text-sm text-amber-600 dark:text-amber-400 pt-2">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {t('paymentInProgress')}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Payment History */}
        {reservation.payments.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <History className="h-5 w-5 text-primary" />
                {t('paymentHistory.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {reservation.payments.map((payment) => {
                  const paymentType = payment.type as 'rental' | 'deposit' | 'deposit_return' | 'damage'
                  const paymentMethod = payment.method as 'stripe' | 'cash' | 'card' | 'transfer' | 'check' | 'other'
                  const paymentStatus = payment.status as 'completed' | 'pending' | 'failed' | 'refunded'
                  const isCompleted = paymentStatus === 'completed'
                  const isRefund = paymentType === 'deposit_return'

                  return (
                    <div
                      key={payment.id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        isCompleted
                          ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
                          : paymentStatus === 'pending'
                          ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
                          : 'bg-muted/30 border-border'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
                          isCompleted
                            ? 'bg-emerald-100 dark:bg-emerald-900/50'
                            : paymentStatus === 'pending'
                            ? 'bg-amber-100 dark:bg-amber-900/50'
                            : 'bg-muted'
                        }`}>
                          {isCompleted ? (
                            <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : paymentStatus === 'pending' ? (
                            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <Banknote className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-sm">
                            {t(`paymentHistory.types.${paymentType}`)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t(`paymentHistory.methods.${paymentMethod}`)}
                            {' • '}
                            {format(payment.paidAt || payment.createdAt, 'dd MMM yyyy', { locale: fr })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${
                          isCompleted
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : paymentStatus === 'pending'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-muted-foreground'
                        }`}>
                          {isRefund ? '-' : ''}{formatCurrency(parseFloat(payment.amount), currency)}
                        </p>
                        <p className={`text-xs ${
                          isCompleted
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : paymentStatus === 'pending'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-muted-foreground'
                        }`}>
                          {t(`paymentHistory.status.${paymentStatus}`)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        {reservation.customerNotes && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <FileText className="h-5 w-5 text-primary" />
                {t('yourNotes')}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground whitespace-pre-line bg-muted/30 rounded-lg p-4">
                {reservation.customerNotes}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Store Contact */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">{t('needHelp')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground mb-4">
              {t('contactStore', { name: store.name })}
            </p>
            <div className="flex flex-wrap gap-3">
              {store.email && (
                <Button variant="outline" size="sm" asChild className="gap-2">
                  <a href={`mailto:${store.email}`}>
                    <Mail className="h-4 w-4" />
                    {store.email}
                  </a>
                </Button>
              )}
              {store.phone && (
                <Button variant="outline" size="sm" asChild className="gap-2">
                  <a href={`tel:${store.phone}`}>
                    <Phone className="h-4 w-4" />
                    {store.phone}
                  </a>
                </Button>
              )}
            </div>
            {store.address && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground mt-4 pt-4 border-t">
                <MapPin className="h-4 w-4 flex-shrink-0" />
                {store.address}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
