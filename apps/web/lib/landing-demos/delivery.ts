import type { StoreSettings } from "@louez/types";

import type { Reservation } from "@/app/(dashboard)/dashboard/reservations/calendar/types";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { Locale } from "@/i18n/config";
import type { DemoBooking } from "@/lib/landing-demos/fixtures";
import { createDemoReservationPages, getDemoToday } from "@/lib/landing-demos/reservations";

export const DEMO_DELIVERY_STORE = {
  id: "demo-store",
  name: "Maison du Vélo",
  address: "12 rue des Cyclistes, 44000 Nantes",
  latitude: "47.2125",
  longitude: "-1.5592",
  settings: {
    reservationMode: "payment",
    advanceNoticeMinutes: 0,
    currency: "EUR",
    country: "FR",
    timezone: "Europe/Paris",
    delivery: {
      enabled: true,
      multiLocationEnabled: false,
      mode: "optional",
      pricePerKm: 1.5,
      minimumFee: 10,
      maximumDistance: 30,
      freeDeliveryThreshold: 200,
      minimumOrderAmountForDelivery: null,
    },
  } satisfies StoreSettings,
};

/** Keep the real rental dates and amounts; add logistics to the shop's busy week. */
export const createDemoDeliveryCalendar = (
  period: RentalPeriodValue,
  booking: DemoBooking,
  locale?: Locale,
) => {
  const data = createDemoReservationPages(period, booking, locale, true);
  const today = getDemoToday(period);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const upcoming = data.calendar.filter(
    (reservation) => reservation.startDate >= today && reservation.startDate <= tomorrow,
  );
  const returning = data.calendar.find(
    (reservation) =>
      reservation.startDate < today &&
      reservation.endDate >= today &&
      reservation.endDate < tomorrow,
  );

  const calendar: Reservation[] = data.calendar.map((reservation) => {
    if (reservation === upcoming[0]) {
      return {
        ...reservation,
        id: "demo-delivery-outbound",
        outboundMethod: "address",
        deliveryAddress: "8 rue de Strasbourg",
        deliveryCity: "Nantes",
        deliveryPostalCode: "44000",
        deliveryCountry: "FR",
      };
    }
    if (reservation === returning || reservation === upcoming[1]) {
      return {
        ...reservation,
        id: reservation === returning ? "demo-delivery-return" : "demo-delivery-round-trip",
        outboundMethod: "address",
        deliveryAddress: "15 quai de la Fosse",
        deliveryCity: "Nantes",
        deliveryPostalCode: "44000",
        deliveryCountry: "FR",
        returnMethod: "address",
        returnAddress: "15 quai de la Fosse",
        returnCity: "Nantes",
        returnPostalCode: "44000",
        returnCountry: "FR",
      };
    }
    return reservation;
  });

  return { ...data, calendar };
};
