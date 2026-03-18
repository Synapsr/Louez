'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Building2,
  Calendar,
  ExternalLink,
  MapPin,
  Package,
  Store,
  Tag,
  Truck,
  Shield,
  User,
} from 'lucide-react'

import { Badge, Button } from '@louez/ui'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@louez/ui'
import { getCurrencySymbol } from '@louez/utils'

import { formatStoreDate } from '@/lib/utils/store-date'
import { orpc } from '@/lib/orpc/react'

import { ActivityTimelineV2 } from './activity-timeline-v2'
import { ReservationHeader } from './reservation-header'
import { ReservationNotes } from './reservation-notes'
import { SmartReservationActions } from './smart-reservation-actions'
import { UnifiedPaymentSection } from './unified-payment-section'
import { UnitAssignmentSelector } from '@/components/dashboard/unit-assignment-selector'
import { InspectionStatusCard } from '@/components/dashboard/inspection-status-card'

type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'ongoing'
  | 'completed'
  | 'cancelled'
  | 'rejected'

type DepositStatus =
  | 'none'
  | 'pending'
  | 'card_saved'
  | 'authorized'
  | 'captured'
  | 'released'
  | 'failed'

type InspectionMode = 'optional' | 'recommended' | 'required'

type BookingAttributeAxis = { key: string; label: string; position?: number }

type ReservationLike = any

interface InspectionData {
  id: string
  type: 'departure' | 'return'
  status: 'draft' | 'completed' | 'signed'
  hasDamage: boolean
  itemCount: number
  photoCount: number
  createdAt: Date | string
  signedAt?: Date | string | null
}

interface InspectionSettingsLike {
  enabled: boolean
  mode: InspectionMode
}

interface ReservationDetailClientProps {
  reservationId: string
  initialReservation: ReservationLike
  storeSlug: string
  currency: string
  storeTimezone?: string
  smsConfigured: boolean
  stripeConfigured: boolean
  inspectionSettings: InspectionSettingsLike
  departureInspection: InspectionData | null
  returnInspection: InspectionData | null
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

export function ReservationDetailClient({
  reservationId,
  initialReservation,
  storeSlug,
  currency,
  storeTimezone,
  smsConfigured,
  stripeConfigured,
  inspectionSettings,
  departureInspection,
  returnInspection,
}: ReservationDetailClientProps) {
  const t = useTranslations('dashboard.reservations')
  const tCommon = useTranslations('common')

  const reservationQuery = useQuery({
    ...orpc.dashboard.reservations.getById.queryOptions({
      input: { reservationId },
    }),
    initialData: initialReservation,
    placeholderData: (prev) => prev,
  })

  const reservation = reservationQuery.data
  if (!reservation) return null

  const currencySymbol = getCurrencySymbol(currency)

  const status = (reservation.status || 'pending') as ReservationStatus

  const startDate = toDate(reservation.startDate) || new Date()
  const endDate = toDate(reservation.endDate) || new Date()
  // Precise duration in days and hours
  const diffMs = endDate.getTime() - startDate.getTime()
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
  const durationDays = Math.floor(totalHours / 24)
  const durationHours = totalHours % 24

  const rental = parseFloat(reservation.totalAmount || '0')
  const deposit = parseFloat(reservation.depositAmount || '0')

  const rentalPaid = (reservation.payments || [])
    .filter((p: any) => p.type === 'rental' && p.status === 'completed')
    .reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0)

  const depositCollected = (reservation.payments || [])
    .filter((p: any) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0)

  const depositReturned = (reservation.payments || [])
    .filter((p: any) => p.type === 'deposit_return' && p.status === 'completed')
    .reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0)

  const hasOnlinePaymentPending = (reservation.payments || []).some(
    (p: any) => p.method === 'stripe' && p.type === 'rental' && p.status === 'pending',
  )

  const hasContract = (reservation.documents || []).some(
    (d: any) => d.type === 'contract',
  )
  const insuredProductIds = new Set<string>(
    Array.isArray(reservation.insuredProductIds)
      ? reservation.insuredProductIds.filter(
          (productId: unknown): productId is string =>
            typeof productId === 'string' && productId.trim().length > 0,
        )
      : [],
  )
  const tulipContractId =
    typeof reservation.tulipContractId === 'string' &&
    reservation.tulipContractId.trim().length > 0
      ? reservation.tulipContractId.trim()
      : null
  const tulipContractUrl = tulipContractId
    ? `https://app.mycolibri.io/fr/contrat/${encodeURIComponent(tulipContractId)}`
    : null

  const formattedDepartureInspection = departureInspection
    ? {
        ...departureInspection,
        createdAt: toDate(departureInspection.createdAt) || new Date(),
        signedAt: toDate(departureInspection.signedAt),
      }
    : null

  const formattedReturnInspection = returnInspection
    ? {
        ...returnInspection,
        createdAt: toDate(returnInspection.createdAt) || new Date(),
        signedAt: toDate(returnInspection.signedAt),
      }
    : null

  return (
    <div className="space-y-6">
      <ReservationHeader
        reservationId={reservation.id}
        reservationNumber={reservation.number}
        status={status}
        createdAt={toDate(reservation.createdAt) || new Date()}
        startDate={startDate}
        endDate={endDate}
        customer={{
          id: reservation.customer.id,
          firstName: reservation.customer.firstName,
          lastName: reservation.customer.lastName,
          email: reservation.customer.email,
        }}
        storeSlug={storeSlug}
        rentalAmount={rental}
        rentalPaid={rentalPaid}
        depositAmount={deposit}
        depositCollected={depositCollected}
        depositReturned={depositReturned}
        totalAmount={parseFloat(reservation.totalAmount)}
        currency={currency}
        sentEmails={reservation.sentEmails || []}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
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
                  {reservation.customer.customerType === 'business' &&
                  reservation.customer.companyName ? (
                    <>
                      <span className="font-medium">
                        {reservation.customer.companyName}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {reservation.customer.firstName}{' '}
                        {reservation.customer.lastName}
                      </span>
                    </>
                  ) : (
                    <span className="font-medium">
                      {reservation.customer.firstName}{' '}
                      {reservation.customer.lastName}
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
                      <span className="text-muted-foreground hidden sm:inline">
                        •
                      </span>
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
                    {reservation.customer.postalCode &&
                      ` ${reservation.customer.postalCode}`}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              className="shrink-0"
              render={<Link href={`/dashboard/customers/${reservation.customer.id}`} />}
            >
              {t('viewCustomer')}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t('items')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex items-center gap-2 flex-wrap">
                  <span>
                    {formatStoreDate(startDate, storeTimezone, 'SHORT_DATETIME')}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>
                    {formatStoreDate(endDate, storeTimezone, 'SHORT_DATETIME')}
                  </span>
                  <span className="text-muted-foreground">
                    ({durationDays > 0 && tCommon('days', { count: durationDays })}
                    {durationDays > 0 && durationHours > 0 && ` ${tCommon('and')} `}
                    {durationHours > 0 && tCommon('hours', { count: durationHours })})
                  </span>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>{t('productName')}</TableHead>
                      <TableHead className="text-center w-20">
                        {t('productQty')}
                      </TableHead>
                      <TableHead className="text-right w-28">
                        {t('productUnitPrice')}
                      </TableHead>
                      <TableHead className="text-right w-28">
                        {t('productTotal')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(reservation.items || []).map((item: any) => {
                      const itemProductId =
                        typeof item.productId === 'string' ? item.productId : null
                      const isTulipInsured =
                        itemProductId !== null &&
                        insuredProductIds.has(itemProductId)
                      const trackUnits = item.product?.trackUnits || false
                      const assignedUnitIds =
                        item.assignedUnits?.map((au: any) => au.productUnitId) ||
                        []
                      const displayAttributes =
                        item.selectedAttributes ||
                        item.productSnapshot?.selectedAttributes ||
                        null
                      const attributeLabelsByKey =
                        item.product?.bookingAttributeAxes?.reduce(
                          (acc: Record<string, string>, axis: BookingAttributeAxis) => {
                            acc[axis.key] = axis.label
                            return acc
                          },
                          {},
                        ) || null

                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <div>
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  {item.productId ? (
                                    <Link
                                      href={`/dashboard/products/${item.productId}`}
                                      target="_blank"
                                      className="hover:underline"
                                    >
                                      {item.productSnapshot?.name || item.product?.name}
                                    </Link>
                                  ) : (
                                    <span>
                                      {item.productSnapshot?.name || item.product?.name}
                                    </span>
                                  )}
                                  {isTulipInsured && (
                                    <Badge
                                      variant="outline"
                                      className="border-emerald-300 bg-emerald-50 text-emerald-700"
                                    >
                                      <Shield className="mr-1 h-3 w-3" />
                                      {t('tulipInsuredBadge')}
                                    </Badge>
                                  )}
                                </div>
                                {displayAttributes &&
                                  Object.keys(displayAttributes).length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {Object.entries(displayAttributes)
                                        .filter(([, value]) =>
                                          Boolean(value && String(value).trim()),
                                        )
                                        .sort(([a], [b]) =>
                                          a.localeCompare(b, 'en'),
                                        )
                                        .map(([key, value]) => (
                                          <Badge
                                            key={`${item.id}-${key}`}
                                            variant="outline"
                                            className="text-xs"
                                          >
                                            {(attributeLabelsByKey?.[key] || key)}:{' '}
                                            {String(value).trim()}
                                          </Badge>
                                        ))}
                                    </div>
                                  )}
                              </div>

                              {trackUnits && (
                                <UnitAssignmentSelector
                                  reservationId={reservation.id}
                                  reservationItemId={item.id}
                                  productName={
                                    item.productSnapshot?.name ||
                                    item.product?.name ||
                                    ''
                                  }
                                  quantity={item.quantity}
                                  trackUnits={trackUnits}
                                  initialAssignedUnitIds={assignedUnitIds}
                                  selectedAttributes={displayAttributes}
                                  attributeLabelsByKey={attributeLabelsByKey}
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center align-top pt-4">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground align-top pt-4">
                            {parseFloat(item.unitPrice).toFixed(2)}
                            {currencySymbol}/u
                          </TableCell>
                          <TableCell className="text-right font-medium align-top pt-4">
                            {parseFloat(item.totalPrice).toFixed(2)}
                            {currencySymbol}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pricing summary */}
              <div className="flex justify-end pt-4">
                <div className="w-64 space-y-2 text-sm">
                  {reservation.taxAmount && parseFloat(reservation.taxAmount) > 0 ? (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t('subtotalExclTax')}</span>
                        <span>
                          {parseFloat(reservation.subtotalExclTax || reservation.subtotalAmount).toFixed(2)}
                          {currencySymbol}
                        </span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t('taxLine', { rate: reservation.taxRate || '0' })}</span>
                        <span>{parseFloat(reservation.taxAmount).toFixed(2)}{currencySymbol}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('subtotalInclTax')}</span>
                        <span className="font-medium">
                          {parseFloat(reservation.subtotalAmount).toFixed(2)}{currencySymbol}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('subtotalRental')}</span>
                      <span className="font-medium">
                        {parseFloat(reservation.subtotalAmount).toFixed(2)}{currencySymbol}
                      </span>
                    </div>
                  )}

                  {reservation.discountAmount && parseFloat(reservation.discountAmount) > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span className="flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5" />
                        {t('promoDiscount')}
                        {reservation.promoCodeSnapshot && (
                          <Badge variant="secondary" className="ml-1 text-xs bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
                            {(reservation.promoCodeSnapshot as { code: string }).code}
                          </Badge>
                        )}
                      </span>
                      <span>-{parseFloat(reservation.discountAmount).toFixed(2)}{currencySymbol}</span>
                    </div>
                  )}

                  {reservation.deliveryFee && parseFloat(reservation.deliveryFee) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Truck className="h-3.5 w-3.5" />
                        {t('deliveryFeeLabel')}
                      </span>
                      <span>{parseFloat(reservation.deliveryFee).toFixed(2)}{currencySymbol}</span>
                    </div>
                  )}

                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>{t('totalAmount')}</span>
                    <span>{parseFloat(reservation.totalAmount).toFixed(2)}{currencySymbol}</span>
                  </div>

                  {parseFloat(reservation.depositAmount) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>{t('totalDeposit')}</span>
                      <span>{parseFloat(reservation.depositAmount).toFixed(2)}{currencySymbol}</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <ActivityTimelineV2
            activities={reservation.activity}
            payments={reservation.payments}
            reservationCreatedAt={reservation.createdAt}
            reservationSource={reservation.source}
            initialVisibleCount={3}
          />
        </div>

        <div className="space-y-4">
          {tulipContractUrl && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  {t('tulipContractCardTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('tulipContractCardDescription')}
                </p>
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {tulipContractId}
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  render={
                    <a
                      href={tulipContractUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  {t('actions.viewContract')}
                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          )}

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
            inspectionEnabled={inspectionSettings.enabled}
            inspectionMode={inspectionSettings.mode}
            hasDepartureInspection={!!departureInspection}
            hasReturnInspection={!!returnInspection}
          />

          {/* Delivery & Return card — shown when any leg uses address delivery */}
          {(reservation.outboundMethod === 'address' || reservation.returnMethod === 'address' || reservation.deliveryOption === 'delivery') && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  {t('deliveryAndReturn')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Outbound leg */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t('outboundLegLabel')}
                  </p>
                  {reservation.outboundMethod === 'address' || (!reservation.outboundMethod && reservation.deliveryAddress) ? (
                    <>
                      <div className="flex items-start gap-2">
                        <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <p className="text-sm">
                          {reservation.deliveryAddress}
                          {reservation.deliveryCity && `, ${reservation.deliveryCity}`}
                          {reservation.deliveryPostalCode && ` ${reservation.deliveryPostalCode}`}
                        </p>
                      </div>
                      {reservation.deliveryDistanceKm && (
                        <p className="text-xs text-muted-foreground ml-5.5">
                          {parseFloat(reservation.deliveryDistanceKm).toFixed(1)} km
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t('storePickup')}</p>
                    </div>
                  )}
                </div>

                {/* Return leg */}
                <div className="space-y-1.5 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t('returnLegLabel')}
                  </p>
                  {reservation.returnMethod === 'address' || (!reservation.returnMethod && reservation.returnAddress) ? (
                    <>
                      <div className="flex items-start gap-2">
                        <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <p className="text-sm">
                          {reservation.returnAddress}
                          {reservation.returnCity && `, ${reservation.returnCity}`}
                          {reservation.returnPostalCode && ` ${reservation.returnPostalCode}`}
                        </p>
                      </div>
                      {reservation.returnDistanceKm && (
                        <p className="text-xs text-muted-foreground ml-5.5">
                          {parseFloat(reservation.returnDistanceKm).toFixed(1)} km
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t('storeReturn')}</p>
                    </div>
                  )}
                </div>

                {reservation.deliveryFee && parseFloat(reservation.deliveryFee) > 0 && (
                  <div className="flex justify-between items-center border-t pt-3 text-sm">
                    <span className="text-muted-foreground">{t('deliveryFeeLabel')}</span>
                    <span className="font-medium">
                      {parseFloat(reservation.deliveryFee).toFixed(2)}{currencySymbol}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <InspectionStatusCard
            reservationId={reservation.id}
            reservationStatus={status}
            departureInspection={formattedDepartureInspection}
            returnInspection={formattedReturnInspection}
            inspectionEnabled={inspectionSettings.enabled}
            inspectionMode={inspectionSettings.mode}
          />

          <UnifiedPaymentSection
            reservationId={reservation.id}
            reservationNumber={reservation.number}
            subtotalAmount={reservation.subtotalAmount}
            depositAmount={reservation.depositAmount}
            totalAmount={reservation.totalAmount}
            payments={reservation.payments}
            status={status}
            currency={currency}
            depositStatus={reservation.depositStatus as DepositStatus | null}
            depositAuthorizationExpiresAt={reservation.depositAuthorizationExpiresAt}
            stripePaymentMethodId={reservation.stripePaymentMethodId}
            customer={{
              firstName: reservation.customer.firstName,
              email: reservation.customer.email,
              phone: reservation.customer.phone,
            }}
            stripeConfigured={stripeConfigured}
          />

          <ReservationNotes
            reservationId={reservation.id}
            initialNotes={reservation.internalNotes || ''}
          />
        </div>
      </div>
    </div>
  )
}
