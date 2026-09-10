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
