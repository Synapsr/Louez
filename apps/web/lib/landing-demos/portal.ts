import type { ComponentProps } from "react";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { ReservationListItem } from "@/components/storefront/account/reservation-list-card";
import type { ReservationPageViewProps } from "@/components/storefront/account/reservation-page-view";
import type { InstantAccessEmail } from "@/lib/email/templates/instant-access";
import type { Locale } from "@/i18n/config";
import { resolveFormatLocale } from "@/lib/i18n/format-locale";
import { getReservationActions } from "@/lib/reservations/util.reservation-actions";
import { formatStoreDate, formatStoreDateRange } from "@/lib/utils/store-date";
import { getDemoProducts, getDemoReservationItems, type DemoBooking } from "./fixtures";
import { createDemoReservationPages, getDemoCustomer, getDemoToday } from "./reservations";

export const PORTAL_STORE = {
  storeName: "Maison du Vélo",
  email: "bonjour@maisonduvelo.example",
  phone: "02 40 00 00 00",
  address: "12 rue des Cyclistes, 44000 Nantes",
};

export interface DemoPortalReservation {
  id: string;
  number: string;
  status: "quote" | "confirmed" | "completed";
  start: Date;
  end: Date;
  created: Date;
  paid: boolean;
  contractValidated: boolean;
  customer: ReturnType<typeof getDemoCustomer>;
  items: ReservationPageViewProps["items"]["items"];
  subtotal: number;
  total: number;
  deposit: number;
}

/** Keep the planning's reservation numbers, rental prices and product lines together. */
export const createDemoPortal = (
  period: RentalPeriodValue,
  booking: DemoBooking,
  locale: Locale,
) => {
  const pages = createDemoReservationPages(period, booking, locale, true);
  const products = getDemoProducts(locale);
  const completedIndex = pages.rows.findIndex((row) => row.status === "completed");
  const create = (
    index: number,
    status: DemoPortalReservation["status"],
  ): DemoPortalReservation => {
    const row = pages.rows[index];
    const display = getDemoReservationItems(pages.bookings[index], locale);
    const created = new Date(
      Math.min(getDemoToday(period).getTime(), new Date(row.startDate).getTime()),
    );
    created.setDate(created.getDate() - 2);
    return {
      id: row.id,
      number: row.number,
      status,
      start: new Date(row.startDate),
      end: new Date(row.endDate),
      created,
      paid: status !== "quote",
      contractValidated: status !== "quote",
      customer: getDemoCustomer(0),
      subtotal: Number(row.subtotalAmount),
      total: Number(row.totalAmount),
      deposit: Number(row.depositAmount),
      items: row.items.map((item, lineIndex) => ({
        id: item.id,
        name: item.productSnapshot.name,
        imageUrl: products.find((product) => product.id === item.product?.id)?.images?.[0] ?? null,
        quantity: item.quantity,
        unitPrice: Number(display.items?.[lineIndex]?.unitPrice ?? 0),
        totalPrice: Number(display.items?.[lineIndex]?.totalPrice ?? 0),
        insured: false,
      })),
    };
  };
  const confirmed = create(0, "confirmed");
  const quote = create(1, "quote");
  const completed = create(completedIndex, "completed");
  return { confirmed, quote, completed, reservations: [confirmed, quote, completed] };
};

export const acceptDemoPortalQuote = (reservation: DemoPortalReservation): DemoPortalReservation =>
  reservation.status === "quote"
    ? { ...reservation, status: "confirmed", contractValidated: true }
    : reservation;

const actionsFor = (reservation: DemoPortalReservation) =>
  getReservationActions({
    status: reservation.status,
    isRentalPaid: reservation.paid,
    isSigned: reservation.contractValidated,
    stripeAccountId: "demo-stripe-account",
    stripeChargesEnabled: true,
  });

export const createDemoPortalList = (
  reservations: DemoPortalReservation[],
  locale: Locale,
): ReservationListItem[] =>
  reservations.map((reservation) => ({
    id: reservation.id,
    number: reservation.number,
    status: reservation.status,
    periodLabel: formatStoreDateRange(
      reservation.start,
      reservation.end,
      "Europe/Paris",
      resolveFormatLocale(locale).intl,
    ),
    itemCount: reservation.items.reduce((sum, item) => sum + item.quantity, 0),
    products: reservation.items.map(({ name, imageUrl }) => ({ name, imageUrl })),
    totalAmount: reservation.total,
    requiredAction: actionsFor(reservation).required,
  }));

export const createDemoPortalDetail = (
  reservation: DemoPortalReservation,
  locale: Locale,
): ReservationPageViewProps => {
  const formatLocale = resolveFormatLocale(locale).intl;
  const date = (value: Date, preset: "SHORT_DATE" | "DATE_AT_TIME" = "DATE_AT_TIME") =>
    formatStoreDate(value, "Europe/Paris", preset, formatLocale);
  const actions = actionsFor(reservation);
  const depositKind =
    reservation.status === "completed" ? "released" : reservation.paid ? "held" : "to_provide";
  const place = {
    kind: "store",
    name: PORTAL_STORE.storeName,
    address: PORTAL_STORE.address,
  } satisfies ReservationPageViewProps["fulfillment"]["fulfillment"]["pickup"];
  const paymentDate = date(reservation.created, "SHORT_DATE");
  const deposit: NonNullable<ReservationPageViewProps["deposit"]>["deposit"] =
    depositKind === "held"
      ? {
          kind: depositKind,
          amount: reservation.deposit,
          expiresLabel: date(new Date(reservation.end.getTime() + 86_400_000), "SHORT_DATE"),
        }
      : depositKind === "released"
        ? { kind: depositKind, amount: reservation.deposit }
        : { kind: depositKind, amount: reservation.deposit, online: true };
  return {
    number: reservation.number,
    status: reservation.status,
    cancelledRequest: false,
    periodLabel: formatStoreDateRange(
      reservation.start,
      reservation.end,
      "Europe/Paris",
      formatLocale,
    ),
    calendarLinks: { google: "#", outlook: "#", office: "#" },
    outcome: { event: null, paymentStatus: reservation.paid ? "paid" : "unpaid" },
    statusCard: {
      status: reservation.status,
      isRentalPaid: reservation.paid,
      paymentRequired: actions.canPay,
      customerEmail: reservation.customer.email,
    },
    actions: {
      storeSlug: "maison-du-velo",
      reservationId: reservation.id,
      actions,
      hasPayment: reservation.paid,
      contractHref: "#",
    },
    fulfillment: {
      fulfillment: { pickup: place, dropoff: place, isSamePlace: true },
      pickupDateLabel: date(reservation.start),
      returnDateLabel: date(reservation.end),
    },
    timeline: {
      status: reservation.status,
      createdLabel: date(reservation.created),
      pickedUpLabel: reservation.status === "completed" ? date(reservation.start) : null,
      returnedLabel: reservation.status === "completed" ? date(reservation.end) : null,
    },
    items: {
      items: reservation.items,
      subtotal: reservation.subtotal,
      deposit: reservation.deposit,
      depositLabel: null,
      damageFees: 0,
      total: reservation.total,
      amountPaid: reservation.paid ? reservation.total : 0,
      isUnsettled: !reservation.paid,
      notes: null,
    },
    updates: {
      updates: [
        {
          id: `${reservation.id}-created`,
          kind: "created",
          dateLabel: date(reservation.created),
          amount: null,
        },
      ],
    },
    deposit: { deposit, authorize: null },
    returnDateRequest: {
      storeSlug: "maison-du-velo",
      reservationId: reservation.id,
      startDate: reservation.start.toISOString(),
      initialEndDate: formatStoreDate(
        reservation.end,
        "Europe/Paris",
        "yyyy-MM-dd'T'HH:mm",
        formatLocale,
      ),
      timezone: "Europe/Paris",
      eligible: reservation.status === "confirmed",
      request: null,
      requestedDateLabel: null,
    },
    payments: {
      payments: reservation.paid
        ? [
            {
              id: `${reservation.id}-rental`,
              type: "rental",
              method: "stripe",
              status: "completed",
              amount: reservation.total,
              dateLabel: paymentDate,
              isRefund: false,
            },
            {
              id: `${reservation.id}-deposit`,
              type: "deposit_hold",
              method: "stripe",
              status: depositKind === "released" ? "cancelled" : "authorized",
              amount: reservation.deposit,
              dateLabel: paymentDate,
              isRefund: false,
            },
          ]
        : [],
    },
    inspections: { inspections: [] },
    invoices: {
      invoices: reservation.paid
        ? [
            {
              id: `${reservation.id}-invoice`,
              number: `FAC-${reservation.created.getFullYear()}-${reservation.number}`,
              type: "invoice",
              amount: reservation.total,
              currency: "EUR",
              dateLabel: paymentDate,
              href: "#",
            },
          ]
        : [],
    },
    contact: PORTAL_STORE,
  };
};

export const createDemoPortalEmail = (
  reservation: DemoPortalReservation,
  locale: Locale,
): ComponentProps<typeof InstantAccessEmail> => ({
  storeName: PORTAL_STORE.storeName,
  storeAddress: PORTAL_STORE.address,
  storePhone: PORTAL_STORE.phone,
  storeEmail: PORTAL_STORE.email,
  storeTimezone: "Europe/Paris",
  storeCountry: "FR",
  customerFirstName: reservation.customer.firstName,
  reservationNumber: reservation.number,
  startDate: reservation.start,
  endDate: reservation.end,
  items: reservation.items,
  totalAmount: reservation.total,
  accessUrl: "#portal-access",
  showPaymentCta: !reservation.paid,
  locale,
  currency: "EUR",
});
