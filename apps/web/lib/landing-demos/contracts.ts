import type { ComponentProps } from "react";

import type { Locale } from "@/i18n/config";
import type { ContractDocument } from "@/lib/pdf/contract";
import { createDemoPeriod, type DemoBooking } from "@/lib/landing-demos/fixtures";
import { createDemoReservationDetail } from "@/lib/landing-demos/reservation-detail";

export type DemoContractSnapshot = {
  start: string;
  end: string;
  referenceDate: string;
};

/** Persist the rolling dates alongside the static PDF so its reservation never drifts. */
export const createDemoContractSnapshot = (): DemoContractSnapshot => {
  const period = createDemoPeriod();
  return {
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    referenceDate: new Date(Math.min(Date.now(), period.start.getTime())).toISOString(),
  };
};

export const createDemoContractDetail = (locale: Locale, snapshot: DemoContractSnapshot) => {
  const period = { start: new Date(snapshot.start), end: new Date(snapshot.end) };
  // Keep the default booking from LandingDemo: two city bikes at EUR 20 each.
  const booking: DemoBooking = {
    productIndex: 0,
    quantity: 2,
    selected: {},
    period,
    unitPrice: 20,
  };
  const detail = createDemoReservationDetail(booking, period, 0, "confirmed", locale);
  const referenceDate = new Date(snapshot.referenceDate);
  const createdAt = new Date(referenceDate.getTime() - 240_000);
  const offset = createdAt.getTime() - detail.reservation.createdAt.getTime();
  const shiftDate = (date: Date) => new Date(date.getTime() + offset);
  return {
    reservation: {
      ...detail.reservation,
      createdAt,
      activity: detail.reservation.activity.map((activity) => ({
        ...activity,
        createdAt: shiftDate(activity.createdAt),
      })),
      payments: detail.reservation.payments.map((payment) => ({
        ...payment,
        createdAt: shiftDate(payment.createdAt),
        paidAt: payment.paidAt ? shiftDate(payment.paidAt) : null,
      })),
    },
    invoices: detail.invoices.map((invoice) => ({
      ...invoice,
      number: `FAC-${referenceDate.getFullYear()}-1042`,
      issueDate: referenceDate.toISOString().slice(0, 10),
    })),
  };
};

export const createDemoContractProps = (
  locale: Locale,
  snapshot: DemoContractSnapshot,
  translations: ComponentProps<typeof ContractDocument>["translations"],
): ComponentProps<typeof ContractDocument> => {
  const { reservation } = createDemoContractDetail(locale, snapshot);
  const validation = reservation.activity.find((activity) => activity.activityType === "confirmed");
  return {
    reservation: {
      ...reservation,
      automaticContractValidation: true,
      signedAt: validation?.createdAt ?? reservation.createdAt,
      signatureIp: null,
      items: (reservation.items ?? []).map((item) => ({
        productSnapshot: { name: item.product?.name ?? "" },
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
      payments: reservation.payments,
    },
    store: {
      name: "Maison du Vélo",
      slug: "maison-du-velo",
      address: "12 rue des Cyclistes, 44000 Nantes",
      logoUrl: null,
    },
    document: {
      number: `${reservation.createdAt.getFullYear()}-1042`,
      generatedAt: reservation.createdAt,
    },
    locale,
    translations,
    currency: "EUR",
    timezone: "Europe/Paris",
    fullCgvHtml: null,
  };
};
