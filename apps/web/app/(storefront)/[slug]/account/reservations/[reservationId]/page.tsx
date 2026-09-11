import { getExtensionAttempt } from "@/lib/reservations/extension.types";
import { AddToCalendarButton } from "@/components/storefront/account/add-to-calendar-button";
import { buildCalendarLinks } from "@/lib/reservations/util.calendar-links";
import { ReturnDateRequestCard } from "@/components/storefront/account/return-date-request-card";
import {
  canRequestDateChange,
  getDateChangeRequests,
} from "@/lib/reservations/util.date-change-request";
import { notFound } from "next/navigation";

import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import {
  db,
  documents,
  inspectionItems,
  inspectionPhotos,
  inspections,
  invoices,
  reservations,
} from "@louez/db";

import { AccountCard } from "@/components/storefront/account/account-card";
import { ReservationActions } from "@/components/storefront/account/reservation-actions";
import { ReservationFulfillmentSummary } from "@/components/storefront/account/reservation-fulfillment-summary";
import { ReservationInvoicesCard } from "@/components/storefront/account/reservation-invoices-card";
import { ReservationItemsCard } from "@/components/storefront/account/reservation-items-card";
import { ReservationCartReset } from "@/components/storefront/account/reservation-cart-reset";
import {
  ReservationDepositCard,
  type ReservationDepositView,
} from "@/components/storefront/account/reservation-deposit-card";
import {
  ReservationInspectionsCard,
  type ReservationInspectionView,
} from "@/components/storefront/account/reservation-inspections-card";
import { ReservationOutcomeBanner } from "@/components/storefront/account/reservation-outcome-banner";
import { ReservationPaymentsCard } from "@/components/storefront/account/reservation-payments-card";
import { ReservationStatusBadge } from "@/components/storefront/account/reservation-status-badge";
import { ReservationStatusCard } from "@/components/storefront/account/reservation-status-card";
import {
  isClosedReservationStatus,
  toReservationStatus,
} from "@/components/storefront/account/reservation-status.constants";
import { ReservationTimeline } from "@/components/storefront/account/reservation-timeline";
import {
  ReservationUpdatesCard,
  type ReservationUpdateView,
} from "@/components/storefront/account/reservation-updates-card";
import { StoreContactCard } from "@/components/storefront/account/store-contact-card";
import { ReviewPromptCard } from "@/components/storefront/review-prompt-card";
import { BackLink } from "@/components/storefront/ui/back-link";
import { StorefrontPageRefresh } from "@/components/storefront/ui/storefront-page-refresh";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { requireCustomerSession } from "@/lib/customer-auth/require-customer-session";
import { parseReservationOutcomeEvent } from "@/lib/customer-auth/util.account-redirect";
import { buildReviewUrl } from "@/lib/google-places";
import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import { getReservationInsuredProductIds } from "@/lib/reservations/get-insured-product-ids";
import {
  canAuthorizeDepositOnline,
  getCustomerDepositView,
} from "@/lib/reservations/util.customer-deposit";
import {
  getCustomerPaymentRows,
  getDamageFees,
  getRentalPaid,
  getReservationPaymentStatus,
  isRefundRow,
  isRentalPaid,
} from "@/lib/reservations/util.payment-status";
import { getReservationActions } from "@/lib/reservations/util.reservation-actions";
import { getReservationUpdates } from "@/lib/reservations/util.reservation-updates";
import {
  formatFulfillmentPlaceLine,
  getFulfillmentPlaceKey,
  resolveReservationFulfillment,
  type FulfillmentLeg,
  type FulfillmentPlace,
} from "@/lib/reservations/util.reservation-fulfillment";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { formatStoreDate, formatStoreDateRange } from "@/lib/utils/store-date";

// Private page data is cached only in this browser for thirty seconds.
export const unstable_dynamicStaleTime = 30;

interface ReservationDetailPageProps {
  params: Promise<{ slug: string; reservationId: string }>;
  searchParams: Promise<{ event?: string | string[] }>;
}

/**
 * The one post-reservation destination: outcome banner (`?event=`), status,
 * actions, period and progress, items, history, deposit, payments,
 * condition reports, invoices, store contact.
 */
export default async function ReservationDetailPage({
  params,
  searchParams,
}: ReservationDetailPageProps) {
  const [{ slug, reservationId }, query] = await Promise.all([params, searchParams]);
  const store = await getStoreBySlug(slug);
  if (!store) notFound();

  const reservationPath = `/account/reservations/${reservationId}`;
  const [session, t, { intl: formatLocale }] = await Promise.all([
    requireCustomerSession(store, reservationPath),
    getTranslations("storefront.account"),
    getRequestFormatLocale(),
  ]);

  const [reservation, invoiceRows] = await Promise.all([
    db.query.reservations.findFirst({
      where: and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id),
        eq(reservations.customerId, session.customerId),
      ),
      with: {
        items: true,
        payments: true,
        activity: {
          columns: {
            id: true,
            metadata: true,
            description: true,
            activityType: true,
            createdAt: true,
          },
          orderBy: (activity, { desc }) => [desc(activity.createdAt)],
        },
      },
    }),
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        type: invoices.type,
        issueDate: invoices.issueDate,
        totalInclTax: invoices.totalInclTax,
        currency: invoices.currency,
      })
      .from(invoices)
      .innerJoin(documents, eq(documents.id, invoices.documentId))
      .where(
        and(
          eq(invoices.reservationId, reservationId),
          eq(invoices.storeId, store.id),
          eq(invoices.customerId, session.customerId),
        ),
      )
      .orderBy(desc(invoices.issueDate), desc(invoices.createdAt)),
  ]);

  if (!reservation) notFound();

  const [insuredProductIds, inspectionRows] = await Promise.all([
    getReservationInsuredProductIds(reservation),
    db
      .select({
        id: inspections.id,
        type: inspections.type,
        hasDamage: inspections.hasDamage,
        estimatedDamageCost: inspections.estimatedDamageCost,
        performedAt: inspections.performedAt,
        signedAt: inspections.signedAt,
        updatedAt: inspections.updatedAt,
      })
      .from(inspections)
      .where(
        and(
          eq(inspections.reservationId, reservationId),
          eq(inspections.storeId, store.id),
          inArray(inspections.status, ["completed", "signed"]),
        ),
      ),
  ]);
  const photoCounts =
    inspectionRows.length > 0
      ? await db
          .select({
            inspectionId: inspectionItems.inspectionId,
            photos: count(inspectionPhotos.id),
          })
          .from(inspectionPhotos)
          .innerJoin(inspectionItems, eq(inspectionItems.id, inspectionPhotos.inspectionItemId))
          .where(
            inArray(
              inspectionItems.inspectionId,
              inspectionRows.map((row) => row.id),
            ),
          )
          .groupBy(inspectionItems.inspectionId)
      : [];
  const cancellation = reservation.activity.find((row) => row.activityType === "cancelled");
  const cancelledRequest =
    reservation.status === "cancelled" &&
    cancellation?.metadata?.source === "customer_request_cancellation";
  const dateRequest = getDateChangeRequests(reservation.activity)[0] ?? null;
  const timezone = store.settings?.timezone;
  const formatDate = (date: Date | string, preset: "SHORT_DATE" | "DATE_AT_TIME") =>
    formatStoreDate(date, timezone, preset, formatLocale);

  const status = toReservationStatus(reservation.status);
  const rentalPaid = isRentalPaid(reservation.payments);
  const rentalPaidAmount = getRentalPaid(reservation.payments);
  const damageFees = getDamageFees(reservation.payments);
  const paymentStatus = getReservationPaymentStatus(reservation.payments);
  const actions = getReservationActions({
    status: reservation.status,
    isRentalPaid: rentalPaid,
    isSigned: reservation.signedAt !== null,
    stripeAccountId: store.stripeAccountId,
    stripeChargesEnabled: store.stripeChargesEnabled,
  });
  const event = parseReservationOutcomeEvent(query.event);
  const stripeActive = Boolean(store.stripeAccountId) && store.stripeChargesEnabled === true;

  const depositView = getCustomerDepositView(reservation);
  const deposit: ReservationDepositView | null = (() => {
    switch (depositView.kind) {
      case "not_required":
        return null;
      case "to_provide":
        return { kind: "to_provide", amount: depositView.amount, online: stripeActive };
      case "held":
        return {
          kind: "held",
          amount: depositView.amount,
          expiresLabel: depositView.expiresAt
            ? formatDate(depositView.expiresAt, "SHORT_DATE")
            : null,
        };
      case "captured":
        return {
          kind: "captured",
          amount: depositView.amount,
          capturedAmount: depositView.capturedAmount,
          releasedAmount: depositView.releasedAmount,
          reason: depositView.reason,
          capturedLabel: depositView.capturedAt
            ? formatDate(depositView.capturedAt, "SHORT_DATE")
            : null,
        };
      case "collected":
        return {
          kind: "collected",
          amount: depositView.amount,
          method: depositView.method,
          receivedLabel: depositView.receivedAt
            ? formatDate(depositView.receivedAt, "SHORT_DATE")
            : null,
        };
      case "returned":
        return {
          kind: "returned",
          amount: depositView.amount,
          returnedAmount: depositView.returnedAmount,
          method: depositView.method,
          returnedLabel: depositView.returnedAt
            ? formatDate(depositView.returnedAt, "SHORT_DATE")
            : null,
          partial: depositView.partial,
        };
      default:
        return depositView;
    }
  })();
  const depositStateKey =
    depositView.kind === "to_provide" && stripeActive
      ? "to_provide_online"
      : depositView.kind === "returned" && depositView.partial
        ? "partially_returned"
        : depositView.kind;
  const depositAuthorization = canAuthorizeDepositOnline({
    view: depositView,
    status: reservation.status,
    startDate: reservation.startDate,
    stripeActive,
  })
    ? { storeSlug: slug, reservationId }
    : null;

  const updates: ReservationUpdateView[] = getReservationUpdates(reservation.activity).map(
    (update) => ({
      id: update.id,
      kind: update.kind,
      dateLabel: formatDate(update.at, "DATE_AT_TIME"),
      amount: "amount" in update ? update.amount : null,
      paymentType: update.kind === "payment_added" ? update.paymentType : undefined,
      byCustomer: update.kind === "cancelled" ? update.byCustomer : undefined,
      note:
        update.kind === "rejected" || update.kind === "deposit_captured"
          ? update.reason
          : update.kind === "inspection_damage_detected"
            ? update.description
            : null,
      periodLabel:
        update.kind === "modified" && update.startDate && update.endDate
          ? formatStoreDateRange(update.startDate, update.endDate, timezone, formatLocale)
          : update.kind === "extension_confirmed"
            ? formatStoreDateRange(reservation.startDate, update.endDate, timezone, formatLocale)
            : null,
    }),
  );

  const inspectionViews: ReservationInspectionView[] = inspectionRows
    .sort((a, b) => (a.type === b.type ? 0 : a.type === "departure" ? -1 : 1))
    .map((row) => ({
      id: row.id,
      type: row.type,
      dateLabel: formatDate(row.performedAt ?? row.updatedAt, "DATE_AT_TIME"),
      signedLabel: row.signedAt ? formatDate(row.signedAt, "DATE_AT_TIME") : null,
      hasDamage: row.hasDamage,
      estimatedDamageCost:
        row.estimatedDamageCost === null ? null : Number.parseFloat(row.estimatedDamageCost),
      photoCount: photoCounts.find((entry) => entry.inspectionId === row.id)?.photos ?? 0,
      href: getStorefrontUrl(slug, `${reservationPath}/inspections/${row.id}`),
    }));

  const fulfillment = resolveReservationFulfillment({ reservation, store });
  const pickupDateLabel = formatDate(reservation.startDate, "DATE_AT_TIME");
  const returnDateLabel = formatDate(reservation.endDate, "DATE_AT_TIME");
  const placeName = (place: FulfillmentPlace, leg: FulfillmentLeg) => {
    const key = getFulfillmentPlaceKey(place, leg);
    return key ? t(`fulfillment.${key}`) : (place.name ?? t("fulfillment.storeFallback"));
  };
  const pickupPlaceLine = formatFulfillmentPlaceLine(
    fulfillment.pickup,
    placeName(fulfillment.pickup, "pickup"),
  );
  const dropoffPlaceLine = formatFulfillmentPlaceLine(
    fulfillment.dropoff,
    placeName(fulfillment.dropoff, "dropoff"),
  );

  const reviewSettings = store.reviewBoosterSettings;
  const reviewUrl =
    status === "completed" &&
    reservation.returnedAt &&
    reviewSettings?.showReviewPromptInPortal &&
    reviewSettings.googlePlaceId
      ? buildReviewUrl(reviewSettings.googlePlaceId)
      : null;

  return (
    <StorefrontSection contentClassName="flex max-w-6xl flex-col gap-4 sm:gap-6">
      <StorefrontPageRefresh renderedAt={Date.now()} />
      <div>
        <BackLink href="/account">{t("backToAccount")}</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {t(status === "pending" || cancelledRequest ? "requestNumber" : "reservationNumber", {
              number: reservation.number,
            })}
          </h1>
          <ReservationStatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatStoreDateRange(reservation.startDate, reservation.endDate, timezone, formatLocale)}
        </p>
      </div>

      <ReservationCartReset event={event} />
      <ReservationOutcomeBanner
        event={status === "pending" || status === "confirmed" ? event : null}
        paymentStatus={paymentStatus}
      />

      <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <ReservationStatusCard
          status={status}
          cancelledRequest={cancelledRequest}
          isRentalPaid={rentalPaid}
          paymentRequired={status === "confirmed" && actions.canPay}
          customerEmail={session.customer.email}
        />

        <ReservationActions
          storeSlug={slug}
          reservationId={reservationId}
          actions={actions}
          hasPayment={reservation.payments.some((payment) =>
            ["completed", "authorized"].includes(payment.status),
          )}
          contractHref={getStorefrontUrl(slug, `${reservationPath}/contract`)}
        />
      </div>

      {reviewUrl ? <ReviewPromptCard storeName={store.name} reviewUrl={reviewUrl} /> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <AccountCard
            title={t("timeline.title")}
            aside={
              ["confirmed", "ongoing", "completed"].includes(status) ? (
                <AddToCalendarButton
                  links={buildCalendarLinks({
                    title: `${store.name} — ${t("reservationNumber", { number: reservation.number })}`,
                    description: [
                      ...reservation.items.map(
                        (item) => `${item.quantity} × ${item.productSnapshot.name}`,
                      ),
                      "",
                      t("fulfillment.calendarPickup", {
                        when: pickupDateLabel,
                        place: pickupPlaceLine,
                      }),
                      t("fulfillment.calendarReturn", {
                        when: returnDateLabel,
                        place: dropoffPlaceLine,
                      }),
                    ].join("\n"),
                    startDate: reservation.startDate.toISOString(),
                    endDate: reservation.endDate.toISOString(),
                    timezone: timezone ?? "UTC",
                    location: pickupPlaceLine,
                  })}
                />
              ) : null
            }
          >
            <ReservationFulfillmentSummary
              fulfillment={fulfillment}
              pickupDateLabel={pickupDateLabel}
              returnDateLabel={returnDateLabel}
            />
            <ReservationTimeline
              status={status}
              cancelledRequest={cancelledRequest}
              closedLabel={cancellation ? formatDate(cancellation.createdAt, "DATE_AT_TIME") : null}
              createdLabel={formatDate(reservation.createdAt, "DATE_AT_TIME")}
              pickedUpLabel={
                reservation.pickedUpAt ? formatDate(reservation.pickedUpAt, "DATE_AT_TIME") : null
              }
              returnedLabel={
                reservation.returnedAt ? formatDate(reservation.returnedAt, "DATE_AT_TIME") : null
              }
            />
          </AccountCard>

          <ReservationItemsCard
            items={reservation.items.map((item) => ({
              id: item.id,
              name: item.productSnapshot.name,
              imageUrl: item.productSnapshot.images?.[0] ?? null,
              quantity: item.quantity,
              unitPrice: Number.parseFloat(item.unitPrice),
              totalPrice: Number.parseFloat(item.totalPrice),
              insured: item.productId !== null && insuredProductIds.has(item.productId),
            }))}
            subtotal={Number.parseFloat(reservation.subtotalAmount)}
            deposit={Number.parseFloat(reservation.depositAmount)}
            depositLabel={
              depositStateKey === "not_required"
                ? null
                : t(`depositCard.states.${depositStateKey}.badge`)
            }
            damageFees={damageFees}
            total={Number.parseFloat(reservation.totalAmount)}
            amountPaid={rentalPaidAmount}
            isUnsettled={rentalPaidAmount === 0 && !isClosedReservationStatus(status)}
            notes={reservation.customerNotes}
          />

          <ReservationUpdatesCard updates={updates} />
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          {deposit ? (
            <ReservationDepositCard deposit={deposit} authorize={depositAuthorization} />
          ) : null}
          <ReturnDateRequestCard
            extension={
              reservation.activity.flatMap((row) => {
                const value = getExtensionAttempt(row.metadata);
                return value
                  ? [
                      {
                        id: row.id,
                        status: value.status,
                        expiresMs: value.expiresMs,
                        supplement: value.supplement,
                        currency: value.currency,
                        requestedEndMs: value.requestedEndMs,
                      },
                    ]
                  : [];
              })[0]
            }
            storeSlug={slug}
            reservationId={reservationId}
            startDate={reservation.startDate.toISOString()}
            initialEndDate={formatStoreDate(
              reservation.endDate,
              timezone,
              "yyyy-MM-dd'T'HH:mm",
              formatLocale,
            )}
            timezone={timezone ?? "UTC"}
            eligible={canRequestDateChange(status)}
            request={dateRequest}
            requestedDateLabel={
              dateRequest ? formatDate(dateRequest.requestedEndDate, "DATE_AT_TIME") : null
            }
          />
          <ReservationPaymentsCard
            payments={getCustomerPaymentRows(reservation.payments).map((payment) => ({
              id: payment.id,
              type: payment.type,
              method: payment.method,
              status: payment.status,
              amount: Number.parseFloat(payment.amount),
              dateLabel: formatDate(payment.paidAt ?? payment.createdAt, "SHORT_DATE"),
              note: ["deposit_capture", "damage"].includes(payment.type) ? payment.notes : null,
              isRefund: isRefundRow(payment),
            }))}
          />

          <ReservationInspectionsCard inspections={inspectionViews} />

          <ReservationInvoicesCard
            invoices={invoiceRows.map((invoice) => ({
              id: invoice.id,
              number: invoice.number,
              type: invoice.type,
              amount: Number(invoice.totalInclTax),
              currency: invoice.currency,
              dateLabel: formatStoreDate(
                `${invoice.issueDate}T12:00:00Z`,
                "UTC",
                "SHORT_DATE",
                formatLocale,
              ),
              href: getStorefrontUrl(slug, `${reservationPath}/invoices/${invoice.id}`),
            }))}
          />

          <StoreContactCard
            storeName={store.name}
            email={store.email}
            phone={store.phone}
            address={store.address}
          />
        </aside>
      </div>
    </StorefrontSection>
  );
}
