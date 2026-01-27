import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations, reservationActivity } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { getTranslations } from 'next-intl/server'
import { getCurrencySymbol } from '@/lib/utils'
import { isSmsConfigured } from '@/lib/sms'
import {
  User,
  Building2,
  MapPin,
  Calendar,
  Package,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table'

import { ReservationHeader } from './reservation-header'
import { SmartReservationActions } from './smart-reservation-actions'
import { ReservationNotes } from './reservation-notes'
import { ActivityTimelineV2 } from './activity-timeline-v2'
import { UnifiedPaymentSection } from './unified-payment-section'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

interface ReservationDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function ReservationDetailPage({
  params,
}: ReservationDetailPageProps) {
  const t = await getTranslations('dashboard.reservations')
  const tCommon = await getTranslations('common')
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const currency = store.settings?.currency || 'EUR'
  const currencySymbol = getCurrencySymbol(currency)

  const { id } = await params

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, id), eq(reservations.storeId, store.id)),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
      payments: true,
      documents: true,
      activity: {
        with: {
          user: true,
        },
        orderBy: [desc(reservationActivity.createdAt)],
      },
    },
  })

  if (!reservation) {
    notFound()
  }

  const status = (reservation.status || 'pending') as ReservationStatus

  const startDate = new Date(reservation.startDate)
  const endDate = new Date(reservation.endDate)
  const days = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  )

  // Calculate payment totals for header
  const rental = parseFloat(reservation.subtotalAmount)
  const deposit = parseFloat(reservation.depositAmount)

  const rentalPaid = reservation.payments
    .filter((p) => p.type === 'rental' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const depositCollected = reservation.payments
    .filter((p) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const depositReturned = reservation.payments
    .filter((p) => p.type === 'deposit_return' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  // Check if there's an online payment pending (Stripe checkout in progress)
  const hasOnlinePaymentPending = reservation.payments.some(
    (p) => p.method === 'stripe' && p.type === 'rental' && p.status === 'pending'
  )

  // Check if contract exists
  const hasContract = reservation.documents.some((d) => d.type === 'contract')

  // Check if SMS is configured
  const smsConfigured = isSmsConfigured()

  return (
    <div className="space-y-6">
      {/* Header with badges and actions */}
      <ReservationHeader
        reservationId={reservation.id}
        reservationNumber={reservation.number}
        status={status}
        createdAt={reservation.createdAt}
        startDate={startDate}
        endDate={endDate}
        customer={{
          id: reservation.customer.id,
          firstName: reservation.customer.firstName,
          lastName: reservation.customer.lastName,
          email: reservation.customer.email,
          phone: reservation.customer.phone,
          customerType: reservation.customer.customerType,
          companyName: reservation.customer.companyName,
        }}
        storeSlug={store.slug}
        rentalAmount={rental}
        rentalPaid={rentalPaid}
        depositAmount={deposit}
        depositCollected={depositCollected}
        depositReturned={depositReturned}
        totalAmount={parseFloat(reservation.totalAmount)}
        hasContract={hasContract}
        currency={currency}
        smsConfigured={smsConfigured}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content - Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info - Inline compact */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                {reservation.customer.customerType === 'business' ? (
                  <Building2 className="h-5 w-5 text-primary" />
                ) : (
                  <User className="h-5 w-5 text-primary" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {reservation.customer.customerType === 'business' && reservation.customer.companyName ? (
                    <>
                      <span className="font-medium">
                        {reservation.customer.companyName}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {reservation.customer.firstName} {reservation.customer.lastName}
                      </span>
                    </>
                  ) : (
                    <span className="font-medium">
                      {reservation.customer.firstName} {reservation.customer.lastName}
                    </span>
                  )}
                  <span className="text-muted-foreground">•</span>
                  <a
                    href={`mailto:${reservation.customer.email}`}
                    className="text-sm text-muted-foreground hover:text-primary truncate"
                  >
                    {reservation.customer.email}
                  </a>
                  {reservation.customer.phone && (
                    <>
                      <span className="text-muted-foreground hidden sm:inline">•</span>
                      <a
                        href={`tel:${reservation.customer.phone}`}
                        className="text-sm text-muted-foreground hover:text-primary hidden sm:inline"
                      >
                        {reservation.customer.phone}
                      </a>
                    </>
                  )}
                </div>
                {reservation.customer.address && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    <MapPin className="h-3 w-3 inline mr-1" />
                    {reservation.customer.address}
                    {reservation.customer.city && `, ${reservation.customer.city}`}
                    {reservation.customer.postalCode && ` ${reservation.customer.postalCode}`}
                  </p>
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0" asChild>
              <Link href={`/dashboard/customers/${reservation.customer.id}`}>
                {t('viewCustomer')}
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>

          {/* Period + Items combined */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t('items')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Period summary - inline */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex items-center gap-2 flex-wrap">
                  <span>
                    {format(startDate, "EEE d MMM 'à' HH:mm", { locale: fr })}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>
                    {format(endDate, "EEE d MMM 'à' HH:mm", { locale: fr })}
                  </span>
                  <span className="text-muted-foreground">
                    ({tCommon('days', { count: days })})
                  </span>
                </div>
              </div>

              {/* Items table */}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>{t('productName')}</TableHead>
                      <TableHead className="text-center w-20">{t('productQty')}</TableHead>
                      <TableHead className="text-right w-28">{t('productUnitPrice')}</TableHead>
                      <TableHead className="text-right w-28">{t('productTotal')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reservation.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.productSnapshot?.name || item.product?.name}
                        </TableCell>
                        <TableCell className="text-center">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {parseFloat(item.unitPrice).toFixed(2)}{currencySymbol}/{store.settings?.pricingMode === 'hour' ? 'h' : 'j'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {parseFloat(item.totalPrice).toFixed(2)}{currencySymbol}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    {/* Tax display - if taxes are present */}
                    {reservation.taxAmount && parseFloat(reservation.taxAmount) > 0 ? (
                      <>
                        <TableRow>
                          <TableCell colSpan={3} className="text-right text-muted-foreground">
                            {t('subtotalExclTax')}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {parseFloat(reservation.subtotalExclTax || reservation.subtotalAmount).toFixed(2)}{currencySymbol}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={3} className="text-right text-muted-foreground">
                            {t('taxLine', { rate: reservation.taxRate || '0' })}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {parseFloat(reservation.taxAmount).toFixed(2)}{currencySymbol}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={3} className="text-right">
                            {t('subtotalInclTax')}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {parseFloat(reservation.subtotalAmount).toFixed(2)}{currencySymbol}
                          </TableCell>
                        </TableRow>
                      </>
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="text-right">
                          {t('subtotalRental')}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {parseFloat(reservation.subtotalAmount).toFixed(2)}{currencySymbol}
                        </TableCell>
                      </TableRow>
                    )}
                    {parseFloat(reservation.depositAmount) > 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-right text-muted-foreground">
                          {t('totalDeposit')}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {parseFloat(reservation.depositAmount).toFixed(2)}{currencySymbol}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={3} className="text-right font-semibold">
                        {t('total')}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {parseFloat(reservation.totalAmount).toFixed(2)}{currencySymbol}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Activity Timeline with fade effect */}
          <ActivityTimelineV2
            activities={reservation.activity}
            reservationCreatedAt={reservation.createdAt}
            reservationSource={reservation.source}
            initialVisibleCount={3}
          />
        </div>

        {/* Sidebar - Right Column */}
        <div className="space-y-4">
          {/* Smart Actions - Contextual with intelligent warnings */}
          <SmartReservationActions
            reservationId={reservation.id}
            status={status}
            startDate={startDate}
            endDate={endDate}
            rentalAmount={rental}
            rentalPaid={rentalPaid}
            depositAmount={deposit}
            depositCollected={depositCollected}
            depositReturned={depositReturned}
            hasOnlinePaymentPending={hasOnlinePaymentPending}
            hasActiveAuthorization={reservation.depositStatus === 'authorized'}
            currency={currency}
          />

          {/* Unified Payment Section - Combines all payment info */}
          <UnifiedPaymentSection
            reservationId={reservation.id}
            subtotalAmount={reservation.subtotalAmount}
            depositAmount={reservation.depositAmount}
            totalAmount={reservation.totalAmount}
            payments={reservation.payments}
            status={status}
            currency={currency}
            depositStatus={reservation.depositStatus as 'none' | 'pending' | 'card_saved' | 'authorized' | 'captured' | 'released' | 'failed' | null}
            depositAuthorizationExpiresAt={reservation.depositAuthorizationExpiresAt}
            stripePaymentMethodId={reservation.stripePaymentMethodId}
          />

          {/* Notes */}
          <ReservationNotes
            reservationId={reservation.id}
            initialNotes={reservation.internalNotes || ''}
          />
        </div>
      </div>
    </div>
  )
}
