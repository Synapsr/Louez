import type { ComponentProps } from "react";
import type { ReservationLocationSnapshot } from "@louez/types";
import type { ReservationStatus } from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import type { UnifiedPaymentSection } from "@/app/(dashboard)/dashboard/reservations/[id]/unified-payment-section";
import type { ReservationInvoiceDocument } from "@/app/(dashboard)/dashboard/reservations/[id]/invoice-documents-card";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { createDemoActivities, getDemoReservationItems, type DemoBooking } from "./fixtures";
import { getDemoCustomer } from "./reservations";

const location: ReservationLocationSnapshot = {
  type: "primary",
  name: "Maison du Vélo",
  address: "12 rue des Cyclistes",
  city: "Nantes",
  postalCode: "44000",
  country: "FR",
};

export const createDemoReservationDetail = (
  booking: DemoBooking,
  period: RentalPeriodValue,
  index: number,
  status: ReservationStatus,
) => {
  const items = getDemoReservationItems(booking);
  const paid = status !== "pending";
  const date = new Date(Math.min(Date.now(), period.start.getTime()));
  const activity = createDemoActivities(
    date,
    Number(items.subtotalAmount),
    Number(items.depositAmount),
  );
  const payments: ComponentProps<typeof UnifiedPaymentSection>["payments"] = paid
    ? [
        {
          id: `demo-payment-${index}`,
          amount: items.subtotalAmount,
          type: "rental",
          method: "stripe",
          status: "completed",
          createdAt: new Date(date.getTime() - 120_000),
          paidAt: new Date(date.getTime() - 120_000),
          notes: null,
          refundOfPaymentId: null,
        },
        {
          id: `demo-hold-${index}`,
          amount: items.depositAmount,
          type: "deposit_hold",
          method: "stripe",
          status: "authorized",
          createdAt: new Date(date.getTime() - 60_000),
          paidAt: null,
          notes: null,
          refundOfPaymentId: null,
        },
      ]
    : [];
  const invoices: ReservationInvoiceDocument[] = paid
    ? [
        {
          id: `demo-invoice-${index}`,
          number: `FAC-${date.getFullYear()}-${String(1042 + index)}`,
          type: "invoice",
          issueDate: date.toISOString().slice(0, 10),
          totalInclTax: items.subtotalAmount,
          currency: "EUR",
          transmissionStatus: "not_applicable",
        },
      ]
    : [];
  return {
    reservation: {
      ...items,
      id: `demo-reservation-${index}`,
      number: String(1042 + index),
      status,
      source: "online",
      startDate: period.start,
      endDate: period.end,
      createdAt: new Date(date.getTime() - 240_000),
      totalAmount: items.subtotalAmount,
      customer: { ...getDemoCustomer(index), phone: null },
      payments,
      activity: paid ? activity : activity.slice(-1),
      depositStatus: paid ? "authorized" : "pending",
      depositAuthorizationExpiresAt: paid ? new Date(period.end.getTime() + 86_400_000) : null,
      stripePaymentMethodId: null,
      outboundMethod: "pickup",
      returnMethod: "pickup",
      pickupLocationSnapshot: location,
      returnLocationSnapshot: location,
      customerNotes: "Nous passerons à l’ouverture pour profiter de la journée.",
      internalNotes: "Préparer les vélos et vérifier la pression des pneus avant le départ.",
      insuredProductIds: [],
      sentEmails: paid ? ["confirmation"] : [],
    },
    invoices,
  };
};
