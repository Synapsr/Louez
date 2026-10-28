import type { InvoiceCompanyNumberScheme } from "./invoice";

/**
 * Billing identity a reservation was booked under, frozen at booking time.
 * Invoices, contracts, and insurance read this rather than the customer's
 * profile, so a later checkout as an individual or a profile edit never
 * rewrites who an existing reservation is billed to.
 */
export interface ReservationBillingSnapshot {
  customerType: "individual" | "business";
  companyName: string | null;
  companyNumber: string | null;
  companyNumberScheme: InvoiceCompanyNumberScheme | null;
  vatNumber: string | null;
}

/**
 * The `errors.*` key of a booking the card gate refused (louez-billing docs/api, README
 * §8.4): the checkout, the dashboard, the phone receptionist and the booking API share
 * it. Its text is generic, with no billing reason (design §6.4). A renter's answer
 * carries renterGateRefusalParams (apps/web/lib/billing/reservation-gate-error.ts): the
 * text shows the store's contact, and needs those params to render.
 */
export const STORE_NOT_ACCEPTING_RESERVATIONS_ERROR = "errors.storeNotAcceptingReservations";
