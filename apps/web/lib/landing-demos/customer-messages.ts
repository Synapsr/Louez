import type { ComponentProps } from "react";
import {
  DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
} from "@louez/types";
import type { NotificationsForm } from "@/app/(dashboard)/dashboard/settings/notifications/notifications-form";
import type { ReservationConfirmationEmail } from "@/lib/email/templates/reservation-confirmation";
import type { ManualEmailRenderContext } from "@/lib/email/manual-reservation-email-core";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { localeCountries, localeNames, type Locale } from "@/i18n/config";
import type { DemoBooking } from "@/lib/landing-demos/fixtures";
import { createDemoReservationDetail } from "@/lib/landing-demos/reservation-detail";

const store = {
  name: "Maison du Vélo",
  email: "bonjour@maisonduvelo.example",
  phone: "+33 2 40 00 00 00",
  address: "12 rue des Cyclistes, 44000 Nantes",
  logoUrl: null,
  settings: { currency: "EUR", country: "FR", timezone: "Europe/Paris" },
};

export const createDemoNotificationSettings = (locale: Locale) =>
  ({
    settings: structuredClone(DEFAULT_NOTIFICATION_SETTINGS),
    customerSettings: structuredClone(DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS),
    discordWebhookUrl: null,
    ownerPhone: store.phone,
    smsQuota: { current: 24, limit: 100, prepaidBalance: 0, allowed: true, totalAvailable: 100 },
    storeLocale: locale,
    storeLanguageName: localeNames[locale],
    storeInfo: store,
  }) satisfies ComponentProps<typeof NotificationsForm>;

// The manual builder selects its language from country. This preview-only override
// keeps the French address, EUR and explicit Paris timezone while selecting the iframe locale.
export const createDemoEmailContext = (
  booking: DemoBooking,
  period: RentalPeriodValue,
  locale: Locale,
): ManualEmailRenderContext => {
  const { reservation } = createDemoReservationDetail(booking, period, 0, "confirmed", locale);
  return {
    store: { ...store, settings: { ...store.settings, country: localeCountries[locale] } },
    customer: reservation.customer,
    reservation: {
      id: reservation.id,
      number: reservation.number,
      startDate: period.start.toISOString(),
      endDate: period.end.toISOString(),
      totalAmount: reservation.totalAmount,
      depositAmount: reservation.depositAmount,
      items: (reservation.items ?? []).map((item) => ({
        name: item.product?.name ?? "",
        quantity: item.quantity,
        totalPrice: item.totalPrice,
      })),
    },
    logoUrl: null,
    reservationUrl: "https://maisonduvelo.example/account/reservations/demo-reservation-0",
    showPaymentCta: false,
  };
};

export const createDemoConfirmationProps = (
  booking: DemoBooking,
  period: RentalPeriodValue,
  locale: Locale,
): ComponentProps<typeof ReservationConfirmationEmail> => {
  const { reservation } = createDemoReservationDetail(booking, period, 0, "confirmed", locale);
  const subtotal = Number(reservation.subtotalAmount);
  const deposit = Number(reservation.depositAmount);
  return {
    storeName: store.name,
    storeEmail: store.email,
    storePhone: store.phone,
    storeAddress: store.address,
    storeCountry: "FR",
    storeTimezone: "Europe/Paris",
    logoUrl: null,
    customerFirstName: reservation.customer.firstName,
    reservationNumber: reservation.number,
    startDate: period.start,
    endDate: period.end,
    items: (reservation.items ?? []).map((item) => ({
      name: item.product?.name ?? "",
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
    })),
    subtotal,
    deposit,
    total: subtotal + deposit,
    reservationUrl: "https://maisonduvelo.example/account/reservations/demo-reservation-0",
    locale,
    currency: "EUR",
  };
};
