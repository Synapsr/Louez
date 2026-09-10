import type { ReservationBillingSnapshot } from "@louez/types";

export interface BillingCustomerLike {
  customerType: "individual" | "business";
  companyName: string | null;
  companyNumber: string | null;
  companyNumberScheme: "fr_siren" | "be_bce" | null;
  vatNumber: string | null;
}

export const INDIVIDUAL_BILLING: ReservationBillingSnapshot = {
  customerType: "individual",
  companyName: null,
  companyNumber: null,
  companyNumberScheme: null,
  vatNumber: null,
};

/**
 * Billing identity derived from a customer profile: the profile's default
 * type, with company identifiers only when that default is business.
 */
export const billingFromCustomer = (customer: BillingCustomerLike): ReservationBillingSnapshot =>
  customer.customerType === "business"
    ? {
        customerType: "business",
        companyName: customer.companyName,
        companyNumber: customer.companyNumber,
        companyNumberScheme: customer.companyNumberScheme,
        vatNumber: customer.vatNumber,
      }
    : INDIVIDUAL_BILLING;

/**
 * The identity a reservation is billed under. The snapshot written at booking
 * wins; rows older than the snapshot column fall back to the customer profile,
 * which is what they were invoiced from before.
 */
export const resolveReservationBilling = (
  reservation: { billingSnapshot: ReservationBillingSnapshot | null | undefined },
  customer: BillingCustomerLike,
): ReservationBillingSnapshot => reservation.billingSnapshot ?? billingFromCustomer(customer);

/** True when the reservation is billed to a company with a name on file. */
export const isBusinessBilling = (billing: ReservationBillingSnapshot): boolean =>
  billing.customerType === "business" && Boolean(billing.companyName);
