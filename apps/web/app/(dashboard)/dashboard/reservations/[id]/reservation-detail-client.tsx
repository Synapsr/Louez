'use client';

import { useState } from 'react';

import Link from 'next/link';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Building2,
  Calendar,
  ExternalLink,
  MapPin,
  Package,
  Shield,
  Store,
  Tag,
  Truck,
  User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription, Badge, Button } from '@louez/ui';
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
} from '@louez/ui';
import { getCurrencySymbol } from '@louez/utils';

import { InspectionStatusCard } from '@/components/dashboard/inspection-status-card';
import { PhoneContactPopover } from '@/components/dashboard/phone-contact-popover';
import { UnitAssignmentSelector } from '@/components/dashboard/unit-assignment-selector';

import { orpc } from '@/lib/orpc/react';
import { formatStoreDate } from '@/lib/utils/store-date';

import { ActivityTimelineV2 } from './activity-timeline-v2';
import { ReservationHeader } from './reservation-header';
import {
  ReservationCustomerNotes,
  ReservationNotes,
} from './reservation-notes';
import { SmartReservationActions } from './smart-reservation-actions';
import { UnifiedPaymentSection } from './unified-payment-section';

type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'ongoing'
  | 'completed'
  | 'cancelled'
  | 'rejected';

type DepositStatus =
  | 'none'
  | 'pending'
  | 'card_saved'
  | 'authorized'
  | 'captured'
  | 'released'
  | 'failed';

type InspectionMode = 'optional' | 'recommended' | 'required';

type BookingAttributeAxis = { key: string; label: string; position?: number };

type ReservationLike = any;

interface InspectionData {
  id: string;
  type: 'departure' | 'return';
  status: 'draft' | 'completed' | 'signed';
  hasDamage: boolean;
  itemCount: number;
  photoCount: number;
  createdAt: Date | string;
  signedAt?: Date | string | null;
}

interface InspectionSettingsLike {
  enabled: boolean;
  mode: InspectionMode;
}

interface ReservationDetailClientProps {
  reservationId: string;
  initialReservation: ReservationLike;
  storeSlug: string;
  currency: string;
  storeTimezone?: string;
  smsConfigured: boolean;
  stripeConfigured: boolean;
  inspectionSettings: InspectionSettingsLike;
  departureInspection: InspectionData | null;
  returnInspection: InspectionData | null;
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function getRentalAmount(reservation: {
  subtotalAmount?: string | null;
  depositAmount?: string | null;
  totalAmount?: string | null;
}) {
  const subtotal = parseFloat(reservation.subtotalAmount || '0');
  const deposit = parseFloat(reservation.depositAmount || '0');
  const total = parseFloat(reservation.totalAmount || '0');

  if (!Number.isFinite(total) || total <= 0) return subtotal;
  if (deposit > 0 && total - subtotal >= deposit - 0.01) {
    return Math.max(0, total - deposit);
  }

  return total;
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
  const t = useTranslations('dashboard.reservations');
  const tCommon = useTranslations('common');
  const [currentTimeMs] = useState(() => Date.now());

  const reservationQuery = useQuery({
    ...orpc.dashboard.reservations.getById.queryOptions({
      input: { reservationId },
    }),
    initialData: initialReservation,
    placeholderData: (prev) => prev,
  });

  const reservation = reservationQuery.data;
  if (!reservation) return null;

  const currencySymbol = getCurrencySymbol(currency);

  const status = (reservation.status || 'pending') as ReservationStatus;

  const startDate = toDate(reservation.startDate) || new Date();
  const endDate = toDate(reservation.endDate) || new Date();
  // Precise duration in days and hours
  const diffMs = endDate.getTime() - startDate.getTime();
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const durationDays = Math.floor(totalHours / 24);
  const durationHours = totalHours % 24;

  const rental = getRentalAmount(reservation);
  const deposit = parseFloat(reservation.depositAmount || '0');

  const rentalPaid = (reservation.payments || [])
    .filter((p: any) => p.type === 'rental' && p.status === 'completed')
    .reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0);

  const depositCollected = (reservation.payments || [])
    .filter((p: any) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0);

  const depositReturned = (reservation.payments || [])
    .filter((p: any) => p.type === 'deposit_return' && p.status === 'completed')
    .reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0);

  const hasOnlinePaymentPending = (reservation.payments || []).some(
    (p: any) =>
      p.method === 'stripe' && p.type === 'rental' && p.status === 'pending',
  );

  const hasContract = (reservation.documents || []).some(
    (d: any) => d.type === 'contract',
  );
  const insuredProductIds = new Set<string>(
    Array.isArray(reservation.insuredProductIds)
      ? reservation.insuredProductIds.filter(
          (productId: unknown): productId is string =>
            typeof productId === 'string' && productId.trim().length > 0,
        )
      : [],
  );
  const tulipContractId =
    typeof reservation.tulipContractId === 'string' &&
    reservation.tulipContractId.trim().length > 0
      ? reservation.tulipContractId.trim()
      : null;
  const tulipContractStatus =
    typeof reservation.tulipContractStatus === 'string' &&
    reservation.tulipContractStatus.trim().length > 0
      ? reservation.tulipContractStatus.trim()
      : null;
  const tulipContractUrl = tulipContractId
    ? `https://app.mycolibri.io/fr/contrat/${encodeURIComponent(tulipContractId)}`
    : null;
  const hasTulipContract =
    tulipContractId !== null &&
    tulipContractStatus !== 'cancelled' &&
    tulipContractStatus !== 'not_required';
  const expectsTulipCoverage =
    reservation.tulipInsuranceOptIn === true && insuredProductIds.size > 0;
  const showTulipPastStartWarning =
    expectsTulipCoverage &&
    !hasTulipContract &&
    startDate.getTime() < currentTimeMs;

  const formattedDepartureInspection = departureInspection
    ? {
        ...departureInspection,
        createdAt: toDate(departureInspection.createdAt) || new Date(),
        signedAt: toDate(departureInspection.signedAt),
      }
    : null;

  const formattedReturnInspection = returnInspection
    ? {
        ...returnInspection,
        createdAt: toDate(returnInspection.createdAt) || new Date(),
        signedAt: toDate(returnInspection.signedAt),
      }
    : null;
  const depositAuthorizationExpiresAt = toDate(
    reservation.depositAuthorizationExpiresAt,
  );
  const hasActiveDepositAuthorization =
    reservation.depositStatus === 'authorized' &&
    (!depositAuthorizationExpiresAt ||
      depositAuthorizationExpiresAt > new Date());

  return (
    <div className="space-y-4 sm:space-y-6">
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
        <div className="space-y-6 lg:col-span-2">
          {showTulipPastStartWarning && (
            <Alert variant="warning">
              <AlertDescription>{t('tulipPastStartWarning')}</AlertDescription>
            </Alert>
          )}

          <div className="bg-card flex items-center justify-between rounded-lg border p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="bg-primary/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                {reservation.customer.customerType === 'business' ? (
                  <Building2 className="text-primary h-5 w-5" />
                ) : (
                  <User className="text-primary h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {/* Name(s) */}
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {reservation.customer.customerType === 'business' &&
                  reservation.customer.companyName ? (
                    <>
                      <span className="truncate font-medium">
                        {reservation.customer.companyName}
                      </span>
                      <span className="text-muted-foreground truncate text-sm">
                        {reservation.customer.firstName}{' '}
                        {reservation.customer.lastName}
                      </span>
                    </>
                  ) : (
                    <span className="truncate font-medium">
                      {reservation.customer.firstName}{' '}
                      {reservation.customer.lastName}
                    </span>
                  )}
                </div>

                {/* Contact (email + phone) */}
                <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <a
                    href={`mailto:${reservation.customer.email}`}
                    className="hover:text-primary min-w-0 truncate"
                  >
                    {reservation.customer.email}
                  </a>
                  {reservation.customer.phone && (
                    <PhoneContactPopover phone={reservation.customer.phone} />
                  )}
                </div>

                {reservation.customer.address && (
                  <p className="text-muted-foreground flex items-start gap-1 truncate text-xs">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {reservation.customer.address}
                      {reservation.customer.city &&
                        `, ${reservation.customer.city}`}
                      {reservation.customer.postalCode &&
                        ` ${reservation.customer.postalCode}`}
                    </span>
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 sm:hidden"
              title={t('viewCustomer')}
              render={
                <Link
                  href={`/dashboard/customers/${reservation.customer.id}`}
                />
              }
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              className="hidden shrink-0 sm:inline-flex"
              render={
                <Link
                  href={`/dashboard/customers/${reservation.customer.id}`}
                />
              }
            >
              {t('viewCustomer')}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                {t('items')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 flex items-start gap-3 rounded-lg p-3 text-sm">
                <Calendar className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    {formatStoreDate(
                      startDate,
                      storeTimezone,
                      'SHORT_DATETIME',
                    )}
                  </span>
                  <ArrowRight className="text-muted-foreground h-3.5 w-3.5" />
                  <span>
                    {formatStoreDate(endDate, storeTimezone, 'SHORT_DATETIME')}
                  </span>
                  <span className="text-muted-foreground">
                    (
                    {durationDays > 0 &&
                      tCommon('days', { count: durationDays })}
                    {durationDays > 0 &&
                      durationHours > 0 &&
                      ` ${tCommon('and')} `}
                    {durationHours > 0 &&
                      tCommon('hours', { count: durationHours })}
                    )
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[520px]">
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>{t('productName')}</TableHead>
                      <TableHead className="w-20 text-center">
                        {t('productQty')}
                      </TableHead>
                      <TableHead className="w-28 text-right">
                        {t('productUnitPrice')}
                      </TableHead>
                      <TableHead className="w-28 text-right">
                        {t('productTotal')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(reservation.items || []).map((item: any) => {
                      const itemProductId =
                        typeof item.productId === 'string'
                          ? item.productId
                          : null;
                      const isTulipInsured =
                        hasTulipContract &&
                        itemProductId !== null &&
                        insuredProductIds.has(itemProductId);
                      const trackUnits = item.product?.trackUnits || false;
                      const assignedUnitIds =
                        item.assignedUnits?.map(
                          (au: any) => au.productUnitId,
                        ) || [];
                      const displayAttributes =
                        item.selectedAttributes ||
                        item.productSnapshot?.selectedAttributes ||
                        null;
                      const attributeLabelsByKey =
                        item.product?.bookingAttributeAxes?.reduce(
                          (
                            acc: Record<string, string>,
                            axis: BookingAttributeAxis,
                          ) => {
                            acc[axis.key] = axis.label;
                            return acc;
                          },
                          {},
                        ) || null;

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
                                      {item.productSnapshot?.name ||
                                        item.product?.name}
                                    </Link>
                                  ) : (
                                    <span>
                                      {item.productSnapshot?.name ||
                                        item.product?.name}
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
                                          Boolean(
                                            value && String(value).trim(),
                                          ),
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
                                            {attributeLabelsByKey?.[key] || key}
                                            : {String(value).trim()}
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
                          <TableCell className="pt-4 text-center align-top">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-muted-foreground pt-4 text-right align-top">
                            {parseFloat(item.unitPrice).toFixed(2)}
                            {currencySymbol}/u
                          </TableCell>
                          <TableCell className="pt-4 text-right align-top font-medium">
                            {parseFloat(item.totalPrice).toFixed(2)}
                            {currencySymbol}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pricing summary */}
              <div className="flex justify-end pt-4">
                <div className="w-full space-y-2 text-sm sm:w-64">
                  {reservation.taxAmount &&
                  parseFloat(reservation.taxAmount) > 0 ? (
                    <>
                      <div className="text-muted-foreground flex justify-between">
                        <span>{t('subtotalExclTax')}</span>
                        <span>
                          {parseFloat(
                            reservation.subtotalExclTax ||
                              reservation.subtotalAmount,
                          ).toFixed(2)}
                          {currencySymbol}
                        </span>
                      </div>
                      <div className="text-muted-foreground flex justify-between">
                        <span>
                          {t('taxLine', { rate: reservation.taxRate || '0' })}
                        </span>
                        <span>
                          {parseFloat(reservation.taxAmount).toFixed(2)}
                          {currencySymbol}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('subtotalInclTax')}</span>
                        <span className="font-medium">
                          {parseFloat(reservation.subtotalAmount).toFixed(2)}
                          {currencySymbol}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t('subtotalRental')}
                      </span>
                      <span className="font-medium">
                        {parseFloat(reservation.subtotalAmount).toFixed(2)}
                        {currencySymbol}
                      </span>
                    </div>
                  )}

                  {reservation.discountAmount &&
                    parseFloat(reservation.discountAmount) > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span className="flex items-center gap-1.5">
                          <Tag className="h-3.5 w-3.5" />
                          {t('promoDiscount')}
                          {reservation.promoCodeSnapshot && (
                            <Badge
                              variant="secondary"
                              className="ml-1 bg-green-100 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300"
                            >
                              {
                                (
                                  reservation.promoCodeSnapshot as {
                                    code: string;
                                  }
                                ).code
                              }
                            </Badge>
                          )}
                        </span>
                        <span>
                          -{parseFloat(reservation.discountAmount).toFixed(2)}
                          {currencySymbol}
                        </span>
                      </div>
                    )}

                  {reservation.deliveryFee &&
                    parseFloat(reservation.deliveryFee) > 0 && (
                      <div className="text-muted-foreground flex justify-between">
                        <span className="flex items-center gap-1.5">
                          <Truck className="h-3.5 w-3.5" />
                          {t('deliveryFeeLabel')}
                        </span>
                        <span>
                          {parseFloat(reservation.deliveryFee).toFixed(2)}
                          {currencySymbol}
                        </span>
                      </div>
                    )}

                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>{t('totalAmount')}</span>
                    <span>
                      {rental.toFixed(2)}
                      {currencySymbol}
                    </span>
                  </div>

                  {parseFloat(reservation.depositAmount) > 0 && (
                    <div className="text-muted-foreground flex justify-between">
                      <span>{t('totalDeposit')}</span>
                      <span>
                        {parseFloat(reservation.depositAmount).toFixed(2)}
                        {currencySymbol}
                      </span>
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
            currency={currency}
            initialVisibleCount={3}
          />
        </div>

        <div className="min-w-0 space-y-4">
          {tulipContractUrl && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4" />
                  {t('tulipContractCardTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  {t('tulipContractCardDescription')}
                </p>
                <p className="text-muted-foreground font-mono text-xs break-all">
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
            hasActiveAuthorization={hasActiveDepositAuthorization}
            currency={currency}
            inspectionEnabled={inspectionSettings.enabled}
            inspectionMode={inspectionSettings.mode}
            hasDepartureInspection={!!departureInspection}
            hasReturnInspection={!!returnInspection}
          />

          {/* Delivery & Return card */}
          {(reservation.outboundMethod === 'address' ||
            reservation.returnMethod === 'address' ||
            reservation.deliveryOption === 'delivery' ||
            reservation.pickupLocationSnapshot ||
            reservation.returnLocationSnapshot) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Truck className="h-4 w-4" />
                  {t('deliveryAndReturn')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Outbound leg */}
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {t('outboundLegLabel')}
                  </p>
                  {reservation.outboundMethod === 'address' ||
                  (!reservation.outboundMethod &&
                    reservation.deliveryAddress) ? (
                    <>
                      <div className="flex items-start gap-2">
                        <MapPin className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <p className="text-sm">
                          {reservation.deliveryAddress}
                          {reservation.deliveryCity &&
                            `, ${reservation.deliveryCity}`}
                          {reservation.deliveryPostalCode &&
                            ` ${reservation.deliveryPostalCode}`}
                        </p>
                      </div>
                      {reservation.deliveryDistanceKm && (
                        <p className="text-muted-foreground ml-5.5 text-xs">
                          {parseFloat(reservation.deliveryDistanceKm).toFixed(
                            1,
                          )}{' '}
                          km
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-start gap-2">
                      <Store className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      <div>
                        <p className="text-sm">
                          {reservation.pickupLocationSnapshot?.name ??
                            t('storePickup')}
                        </p>
                        {reservation.pickupLocationSnapshot?.address && (
                          <p className="text-muted-foreground text-xs">
                            {reservation.pickupLocationSnapshot.address}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Return leg */}
                <div className="space-y-1.5 border-t pt-3">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {t('returnLegLabel')}
                  </p>
                  {reservation.returnMethod === 'address' ||
                  (!reservation.returnMethod && reservation.returnAddress) ? (
                    <>
                      <div className="flex items-start gap-2">
                        <MapPin className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <p className="text-sm">
                          {reservation.returnAddress}
                          {reservation.returnCity &&
                            `, ${reservation.returnCity}`}
                          {reservation.returnPostalCode &&
                            ` ${reservation.returnPostalCode}`}
                        </p>
                      </div>
                      {reservation.returnDistanceKm && (
                        <p className="text-muted-foreground ml-5.5 text-xs">
                          {parseFloat(reservation.returnDistanceKm).toFixed(1)}{' '}
                          km
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-start gap-2">
                      <Store className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      <div>
                        <p className="text-sm">
                          {reservation.returnLocationSnapshot?.name ??
                            reservation.pickupLocationSnapshot?.name ??
                            t('storeReturn')}
                        </p>
                        {(reservation.returnLocationSnapshot?.address ||
                          reservation.pickupLocationSnapshot?.address) && (
                          <p className="text-muted-foreground text-xs">
                            {reservation.returnLocationSnapshot?.address ??
                              reservation.pickupLocationSnapshot?.address}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {reservation.deliveryFee &&
                  parseFloat(reservation.deliveryFee) > 0 && (
                    <div className="flex items-center justify-between border-t pt-3 text-sm">
                      <span className="text-muted-foreground">
                        {t('deliveryFeeLabel')}
                      </span>
                      <span className="font-medium">
                        {parseFloat(reservation.deliveryFee).toFixed(2)}
                        {currencySymbol}
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
            depositAuthorizationExpiresAt={depositAuthorizationExpiresAt}
            stripePaymentMethodId={reservation.stripePaymentMethodId}
            customer={{
              firstName: reservation.customer.firstName,
              email: reservation.customer.email,
              phone: reservation.customer.phone,
            }}
            stripeConfigured={stripeConfigured}
          />

          <ReservationCustomerNotes notes={reservation.customerNotes || ''} />

          <ReservationNotes
            reservationId={reservation.id}
            initialNotes={reservation.internalNotes || ''}
          />
        </div>
      </div>
    </div>
  );
}
