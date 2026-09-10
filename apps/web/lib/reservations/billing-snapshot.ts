import type { ReservationBillingSnapshot } from "@louez/types";
import { INDIVIDUAL_BILLING } from "@louez/utils";
import {
  digitsOnly,
  isPlausibleVatNumber,
  isValidCompanyNumber,
  resolveCompanyNumberScheme,
  type CreateReservationCustomerInput,
} from "@louez/validations";

export interface CustomerCompanyIdentity {
  companyNumber: string | null;
  companyNumberScheme: "fr_siren" | "be_bce" | null;
  vatNumber: string | null;
}

/**
 * Normalize and validate company identifiers before persisting invoice data.
 * Null means the business identity is invalid (missing company name, bad
 * SIREN/BCE, implausible VAT number).
 */
export const resolveCustomerCompanyIdentity = (
  customer: CreateReservationCustomerInput,
  country: string,
): CustomerCompanyIdentity | null => {
  const empty: CustomerCompanyIdentity = {
    companyNumber: null,
    companyNumberScheme: null,
    vatNumber: null,
  };

  if (customer.customerType !== "business") return empty;
  if (!customer.companyName?.trim()) return null;

  const scheme = resolveCompanyNumberScheme(country);
  const rawCompanyNumber = customer.companyNumber?.trim() ?? "";
  let companyNumber: string | null = null;

  if (rawCompanyNumber) {
    if (!isValidCompanyNumber(country, rawCompanyNumber)) return null;
    companyNumber = scheme ? digitsOnly(rawCompanyNumber) : rawCompanyNumber;
  }

  const vatNumber = customer.vatNumber?.replace(/\s/g, "").toUpperCase() ?? "";
  if (!isPlausibleVatNumber(country, vatNumber)) return null;

  return {
    companyNumber,
    companyNumberScheme: companyNumber ? scheme : null,
    vatNumber: vatNumber || null,
  };
};

/**
 * Billing identity frozen on the reservation: what the checkout said, with
 * the identifiers as normalized above. An individual checkout carries no
 * company at all, whatever the profile holds.
 */
export const buildReservationBillingSnapshot = (
  customer: Pick<CreateReservationCustomerInput, "customerType" | "companyName">,
  companyIdentity: CustomerCompanyIdentity,
): ReservationBillingSnapshot =>
  customer.customerType === "business"
    ? {
        customerType: "business",
        companyName: customer.companyName?.trim() || null,
        companyNumber: companyIdentity.companyNumber,
        companyNumberScheme: companyIdentity.companyNumberScheme,
        vatNumber: companyIdentity.vatNumber,
      }
    : INDIVIDUAL_BILLING;
