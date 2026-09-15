"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Building2, ExternalLink, MapPin, Pencil, Store, Truck, Shield, User } from "lucide-react";

import { Button } from "@louez/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@louez/ui";
import {
  cn,
  formatCurrency,
  formatNumber,
  isBusinessBilling,
  resolveReservationBilling,
} from "@louez/utils";

import { useFormatLocale } from "@/hooks/use-format-locale";
import { orpc } from "@/lib/orpc/react";
import { captureReservationViewed } from "@/lib/product-analytics/reservation-analytics-client";

import { ActivityTimelineV2 } from "./activity-timeline-v2";
import { AdvisorConversationCard } from "./advisor-conversation-card";
import { EmailContactPopover } from "@/components/dashboard/email-contact-popover";
import { PhoneContactPopover } from "@/components/dashboard/phone-contact-popover";
import { ReservationItemsCard } from "./reservation-items-card";
import { ReservationHeader } from "./reservation-header";
import { ReservationBillingDialog } from "./reservation-billing-dialog";
import { ReservationCustomerNotes, ReservationNotes } from "./reservation-notes";
import { SmartReservationActions } from "./smart-reservation-actions";
import { UnifiedPaymentSection, type PaymentMethod } from "./unified-payment-section";
import { hasMobileReservationQuickActions } from "./util.mobile-reservation-quick-actions";
import { getNetCompletedPaymentAmount } from "./util.payment-refunds";
import { UnitAssignmentSelector } from "@/components/dashboard/unit-assignment-selector";
import { InspectionStatusCard } from "@/components/dashboard/inspection-status-card";
import { ReservationStoreLegsSummary } from "@/components/dashboard/reservation-store-legs-summary";
import { storeLegLocationFromSnapshot } from "@/components/dashboard/util.reservation-store-legs";
import { InvoiceDocumentsCard, type ReservationInvoiceDocument } from "./invoice-documents-card";
import { getReservationDeliveryDisplayMode } from "./util.reservation-delivery-display";

type ReservationStatus =
  | "pending"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled"
  | "rejected";

type DepositStatus =
  | "none"
  | "pending"
  | "card_saved"
  | "authorized"
  | "captured"
  | "released"
  | "failed";

type InspectionMode = "optional" | "recommended" | "required";

type ReservationLike = any;

interface InspectionData {
  id: string;
  type: "departure" | "return";
  status: "draft" | "completed" | "signed";
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
  showStoreLocations: boolean;
  departureInspection: InspectionData | null;
  returnInspection: InspectionData | null;
  defaultPaymentMethod?: PaymentMethod;
  invoices: ReservationInvoiceDocument[];
  canGenerateInvoice: boolean;
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
  const subtotal = parseFloat(reservation.subtotalAmount || "0");
  const deposit = parseFloat(reservation.depositAmount || "0");
  const total = parseFloat(reservation.totalAmount || "0");

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
  smsConfigured: _smsConfigured,
  stripeConfigured,
  inspectionSettings,
  showStoreLocations,
  departureInspection,
  returnInspection,
  defaultPaymentMethod,
  invoices,
  canGenerateInvoice,
}: ReservationDetailClientProps) {
  const t = useTranslations("dashboard.reservations");
  const { intl: formatLocale } = useFormatLocale();
  const hasCapturedReservationView = useRef(false);
  const [isBillingDialogOpen, setIsBillingDialogOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const reservationQuery = useQuery({
    ...orpc.dashboard.reservations.getById.queryOptions({
      input: { reservationId },
    }),
    initialData: initialReservation,
    placeholderData: (prev) => prev,
  });

  const reservation = reservationQuery.data;

  useEffect(() => {
    if (hasCapturedReservationView.current) return;
    hasCapturedReservationView.current = true;

    captureReservationViewed({
      reservationId,
      reservationStatus:
        typeof initialReservation?.status === "string" ? initialReservation.status : null,
      properties: {
        has_deposit: Number.parseFloat(initialReservation?.depositAmount || "0") > 0,
        inspection_enabled: inspectionSettings.enabled,
        inspection_mode: inspectionSettings.mode,
      },
    });
  }, [initialReservation, inspectionSettings.enabled, inspectionSettings.mode, reservationId]);

  if (!reservation) return null;

  const status = (reservation.status || "pending") as ReservationStatus;
  // Who this reservation is billed to: the booking snapshot, or the profile for older rows.
  const billing = resolveReservationBilling(reservation, reservation.customer);

  const startDate = toDate(reservation.startDate) || new Date();
  const endDate = toDate(reservation.endDate) || new Date();
  // Precise duration in days and hours
  const diffMs = endDate.getTime() - startDate.getTime();
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const durationDays = Math.floor(totalHours / 24);
  const durationHours = totalHours % 24;

  const rental = getRentalAmount(reservation);
  const deposit = parseFloat(reservation.depositAmount || "0");
  const deliveryDisplayMode = getReservationDeliveryDisplayMode({
    reservation,
    showStoreLocations,
  });

  const rentalPaid = getNetCompletedPaymentAmount(reservation.payments || [], "rental");

  const depositCollected = (reservation.payments || [])
    .filter((p: any) => p.type === "deposit" && p.status === "completed")
    .reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0);

  const depositReturned = (reservation.payments || [])
    .filter((p: any) => p.type === "deposit_return" && p.status === "completed")
    .reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0);

  const hasOnlinePaymentPending = (reservation.payments || []).some(
    (p: any) => p.method === "stripe" && p.type === "rental" && p.status === "pending",
  );

  const insuredProductIds = new Set<string>(
    Array.isArray(reservation.insuredProductIds)
      ? reservation.insuredProductIds.filter(
          (productId: unknown): productId is string =>
            typeof productId === "string" && productId.trim().length > 0,
        )
      : [],
  );
  const tulipContractId =
    typeof reservation.tulipContractId === "string" && reservation.tulipContractId.trim().length > 0
      ? reservation.tulipContractId.trim()
      : null;
  const tulipContractUrl = tulipContractId
    ? `https://app.mycolibri.io/fr/contrat/${encodeURIComponent(tulipContractId)}`
    : null;

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
  const depositAuthorizationExpiresAt = toDate(reservation.depositAuthorizationExpiresAt);
  const hasActiveDepositAuthorization =
    reservation.depositStatus === "authorized" &&
    (!depositAuthorizationExpiresAt || depositAuthorizationExpiresAt > new Date());
  const rentalRemaining = Math.max(0, rental - rentalPaid);
  const showMobileQuickActions = hasMobileReservationQuickActions({
    status,
    rentalRemaining,
    hasOnlinePaymentPending,
  });

  return (
    <div className={cn("space-y-4 sm:space-y-6", showMobileQuickActions && "pb-28 md:pb-0")}>
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

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6 min-w-0">
          <div className="flex items-start justify-between gap-2 p-3 sm:p-4 rounded-lg border bg-card">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                {isBusinessBilling(billing) ? (
                  <Building2 className="h-5 w-5 text-primary" />
                ) : (
                  <User className="h-5 w-5 text-primary" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {/* Name(s) */}
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  {isBusinessBilling(billing) ? (
                    <>
                      <span className="font-medium truncate">{billing.companyName}</span>
                      <span className="text-sm text-muted-foreground truncate">
                        {reservation.customer.firstName} {reservation.customer.lastName}
                      </span>
                    </>
                  ) : (
                    <span className="font-medium truncate">
                      {reservation.customer.firstName} {reservation.customer.lastName}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground"
                    title={t("billing.edit")}
                    aria-label={t("billing.edit")}
                    onClick={() => setIsBillingDialogOpen(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {isBusinessBilling(billing) && (billing.companyNumber || billing.vatNumber) && (
                  <p className="text-xs text-muted-foreground truncate">
                    {[billing.companyNumber, billing.vatNumber].filter(Boolean).join(" · ")}
                  </p>
                )}

                {/* Contact (email + phone) */}
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap min-w-0 text-sm text-muted-foreground">
                  <EmailContactPopover
                    email={reservation.customer.email}
                    className="min-w-0 truncate"
                  />
                  {reservation.customer.phone && (
                    <PhoneContactPopover phone={reservation.customer.phone} />
                  )}
                </div>

                {reservation.customer.address && (
                  <p className="text-xs text-muted-foreground truncate flex items-start gap-1">
                    <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="truncate">
                      {reservation.customer.address}
                      {reservation.customer.city && `, ${reservation.customer.city}`}
                      {reservation.customer.postalCode && ` ${reservation.customer.postalCode}`}
                    </span>
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 sm:hidden"
              title={t("viewCustomer")}
              render={<Link href={`/dashboard/customers/${reservation.customer.id}`} />}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              className="shrink-0 hidden sm:inline-flex"
              render={<Link href={`/dashboard/customers/${reservation.customer.id}`} />}
            >
              {t("viewCustomer")}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
          {isBillingDialogOpen && (
            <ReservationBillingDialog
              reservationId={reservation.id}
              billing={billing}
              onClose={() => setIsBillingDialogOpen(false)}
            />
          )}

          <ReservationItemsCard
            reservation={reservation}
            startDate={startDate}
            endDate={endDate}
            storeTimezone={storeTimezone}
            durationDays={durationDays}
            durationHours={durationHours}
            currency={currency}
            rental={rental}
            insuredProductIds={insuredProductIds}
            renderUnitAssignment={(item) =>
              item.product?.trackUnits ? (
                <UnitAssignmentSelector
                  reservationId={reservation.id}
                  reservationItemId={item.id}
                  productName={item.productSnapshot?.name || item.product?.name || ""}
                  quantity={item.quantity}
                  trackUnits={item.product.trackUnits}
                  initialAssignedUnitIds={
                    item.assignedUnits?.map((unit) => unit.productUnitId) || []
                  }
                  selectedAttributes={
                    item.selectedAttributes || item.productSnapshot?.selectedAttributes || null
                  }
                  attributeLabelsByKey={
                    item.product.bookingAttributeAxes?.reduce<Record<string, string>>(
                      (labels, axis) => ({ ...labels, [axis.key]: axis.label }),
                      {},
                    ) || null
                  }
                />
              ) : null
            }
          />

          <ActivityTimelineV2
            activities={reservation.activity}
            payments={reservation.payments}
            reservationCreatedAt={reservation.createdAt}
            reservationSource={reservation.source}
            currency={currency}
            initialVisibleCount={3}
          />
        </div>

        <div className="space-y-4 min-w-0">
          <InvoiceDocumentsCard
            reservationId={reservation.id}
            invoices={invoices}
            canGenerate={canGenerateInvoice}
          />

          {tulipContractUrl && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  {t("tulipContractCardTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("tulipContractCardDescription")}</p>
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {tulipContractId}
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  render={<a href={tulipContractUrl} target="_blank" rel="noopener noreferrer" />}
                >
                  {t("actions.viewContract")}
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
            onRecordPayment={() => setPaymentModalOpen(true)}
          />

          <ReservationCustomerNotes notes={reservation.customerNotes || ""} />

          {deliveryDisplayMode === "compact" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Store className="h-4 w-4" />
                  {t("pickupAndReturn")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ReservationStoreLegsSummary
                  pickupLocation={storeLegLocationFromSnapshot(
                    reservation.pickupLocationSnapshot ?? reservation.returnLocationSnapshot,
                  )}
                  returnLocation={storeLegLocationFromSnapshot(
                    reservation.returnLocationSnapshot ?? reservation.pickupLocationSnapshot,
                  )}
                />
              </CardContent>
            </Card>
          )}

          {/* Delivery & Return card */}
          {deliveryDisplayMode === "full" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  {t("deliveryAndReturn")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Outbound leg */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t("outboundLegLabel")}
                  </p>
                  {reservation.outboundMethod === "address" ||
                  (!reservation.outboundMethod && reservation.deliveryAddress) ? (
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
                          {formatNumber(
                            parseFloat(reservation.deliveryDistanceKm),
                            1,
                            formatLocale,
                          )}{" "}
                          km
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-start gap-2">
                      <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-sm">
                          {reservation.pickupLocationSnapshot?.name ?? t("storePickup")}
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
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t("returnLegLabel")}
                  </p>
                  {reservation.returnMethod === "address" ||
                  (!reservation.returnMethod && reservation.returnAddress) ? (
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
                          {formatNumber(parseFloat(reservation.returnDistanceKm), 1, formatLocale)}{" "}
                          km
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-start gap-2">
                      <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-sm">
                          {reservation.returnLocationSnapshot?.name ??
                            reservation.pickupLocationSnapshot?.name ??
                            t("storeReturn")}
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

                {reservation.deliveryFee && parseFloat(reservation.deliveryFee) > 0 && (
                  <div className="flex justify-between items-center border-t pt-3 text-sm">
                    <span className="text-muted-foreground">{t("deliveryFeeLabel")}</span>
                    <span className="font-medium">
                      {formatCurrency(parseFloat(reservation.deliveryFee), currency, formatLocale)}
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
            defaultPaymentMethod={defaultPaymentMethod}
            paymentModalOpen={paymentModalOpen}
            onPaymentModalOpenChange={setPaymentModalOpen}
          />

          <AdvisorConversationCard reservationId={reservation.id} />

          <ReservationNotes
            reservationId={reservation.id}
            initialNotes={reservation.internalNotes || ""}
          />
        </div>
      </div>
    </div>
  );
}
