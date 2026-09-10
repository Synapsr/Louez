import { getExtensionAttempt } from "@/lib/reservations/extension.types";
import { AddToCalendarButton } from "@/components/storefront/account/add-to-calendar-button";
import { buildCalendarLinks } from "@/lib/reservations/util.calendar-links";
import { ReturnDateRequestCard } from "@/components/storefront/account/return-date-request-card";
import {
  canRequestDateChange,
  getDateChangeRequests,
} from "@/lib/reservations/util.date-change-request";
import { notFound } from "next/navigation";

import { and, desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { db, documents, invoices, reservations } from "@louez/db";

import { AccountCard } from "@/components/storefront/account/account-card";
import { ReservationCartReset } from "@/components/storefront/account/reservation-cart-reset";
import { ReservationActions } from "@/components/storefront/account/reservation-actions";
import { ReservationInvoicesCard } from "@/components/storefront/account/reservation-invoices-card";
import { ReservationItemsCard } from "@/components/storefront/account/reservation-items-card";
import { ReservationOutcomeBanner } from "@/components/storefront/account/reservation-outcome-banner";
import { ReservationPaymentsCard } from "@/components/storefront/account/reservation-payments-card";
import { ReservationStatusBadge } from "@/components/storefront/account/reservation-status-badge";
import { ReservationStatusCard } from "@/components/storefront/account/reservation-status-card";
import { toReservationStatus } from "@/components/storefront/account/reservation-status.constants";
import { ReservationTimeline } from "@/components/storefront/account/reservation-timeline";
import { StoreContactCard } from "@/components/storefront/account/store-contact-card";
import { ReviewPromptCard } from "@/components/storefront/review-prompt-card";
import { BackLink } from "@/components/storefront/ui/back-link";
import { StorefrontPageRefresh } from "@/components/storefront/ui/storefront-page-refresh";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { requireCustomerSession } from "@/lib/customer-auth/require-customer-session";
import { parseReservationOutcomeEvent } from "@/lib/customer-auth/util.account-redirect";
import { buildReviewUrl } from "@/lib/google-places";
import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import {
  getReservationPaymentStatus,
  getTotalPaid,
  isRentalPaid,
} from "@/lib/reservations/util.payment-status";
import { getReservationActions } from "@/lib/reservations/util.reservation-actions";
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
 * actions, period and progress, items, payments, invoices, store contact.
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
          columns: { id: true, metadata: true },
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

  const dateRequest = getDateChangeRequests(reservation.activity)[0] ?? null;
  const timezone = store.settings?.timezone;
  const formatDate = (date: Date | string, preset: "SHORT_DATE" | "DATE_AT_TIME") =>
    formatStoreDate(date, timezone, preset, formatLocale);

  const status = toReservationStatus(reservation.status);
  const rentalPaid = isRentalPaid(reservation.payments);
  const paymentStatus = getReservationPaymentStatus(reservation.payments);
  const actions = getReservationActions({
    status: reservation.status,
    isRentalPaid: rentalPaid,
    isSigned: reservation.signedAt !== null,
    stripeAccountId: store.stripeAccountId,
    stripeChargesEnabled: store.stripeChargesEnabled,
  });
  const event = parseReservationOutcomeEvent(query.event);

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
            {t("reservationNumber", { number: reservation.number })}
          </h1>
          <ReservationStatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatStoreDateRange(reservation.startDate, reservation.endDate, timezone, formatLocale)}
        </p>
      </div>

      <ReservationCartReset event={event} />
      <ReservationOutcomeBanner event={event} paymentStatus={paymentStatus} />

      <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <ReservationStatusCard
          status={status}
          isRentalPaid={rentalPaid}
          paymentRequired={status === "confirmed" && actions.canPay}
        />

        <ReservationActions
          storeSlug={slug}
          reservationId={reservationId}
          actions={actions}
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
                    description: reservation.items
                      .map((item) => `${item.quantity} × ${item.productSnapshot.name}`)
                      .join("\n"),
                    startDate: reservation.startDate.toISOString(),
                    endDate: reservation.endDate.toISOString(),
                    timezone: timezone ?? "UTC",
                    location:
                      reservation.outboundMethod === "address"
                        ? [
                            reservation.deliveryAddress,
                            reservation.deliveryPostalCode,
                            reservation.deliveryCity,
                          ]
                            .filter(Boolean)
                            .join(", ")
                        : reservation.pickupLocationSnapshot
                          ? [
                              reservation.pickupLocationSnapshot.address,
                              reservation.pickupLocationSnapshot.postalCode,
                              reservation.pickupLocationSnapshot.city,
                            ]
                              .filter(Boolean)
                              .join(", ")
                          : (store.address ?? ""),
                  })}
                />
              ) : null
            }
          >
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted p-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t("start")}</dt>
                <dd className="font-medium">{formatDate(reservation.startDate, "DATE_AT_TIME")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("end")}</dt>
                <dd className="font-medium">{formatDate(reservation.endDate, "DATE_AT_TIME")}</dd>
              </div>
            </dl>
            <ReservationTimeline
              status={status}
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
            }))}
            subtotal={Number.parseFloat(reservation.subtotalAmount)}
            deposit={Number.parseFloat(reservation.depositAmount)}
            total={Number.parseFloat(reservation.totalAmount)}
            totalPaid={getTotalPaid(reservation.payments)}
            notes={reservation.customerNotes}
          />
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
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
            payments={reservation.payments.map((payment) => ({
              id: payment.id,
              type: payment.type,
              method: payment.method,
              status: payment.status,
              amount: Number.parseFloat(payment.amount),
              dateLabel: formatDate(payment.paidAt ?? payment.createdAt, "SHORT_DATE"),
            }))}
          />

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
