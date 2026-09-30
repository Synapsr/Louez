import type {
  CustomerAcquisitionSource,
  CustomerFieldValues,
  CustomerSocialLinks,
  CustomerSocialNetwork,
} from "@louez/types";

import type { DashboardCreationSource } from "@/lib/openreplay/events";

export type CustomerFormOpenReplaySource = DashboardCreationSource;

/** The columns of a customer the form edits. */
export interface CustomerFormCustomer {
  id: string;
  customerType: "individual" | "business";
  email: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  companyNumber: string | null;
  vatNumber: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  birthDate: string | null;
  acquisitionSource: CustomerAcquisitionSource | null;
  acquisitionSourceDetail: string | null;
  socialLinks: CustomerSocialLinks | null;
  notes: string | null;
}

/** What the customer form holds: strings, blank when empty. */
export interface CustomerFormValues {
  customerType: "individual" | "business";
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  companyNumber: string;
  vatNumber: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  birthDate: string;
  acquisitionSource: CustomerAcquisitionSource | "";
  acquisitionSourceDetail: string;
  socialLinks: Partial<Record<CustomerSocialNetwork, string>>;
  notes: string;
  customFields: CustomerFieldValues;
}

/**
 * Where the form saves. The new-customer page and dialog create; the edit
 * page writes the whole record; the record's Sheet only the items it shows.
 */
export type CustomerFormSave =
  | { kind: "create" }
  | { kind: "update"; customerId: string }
  | { kind: "record"; customerId: string };

/** Values a search already typed, to start a new customer from (the quick-create dialog). */
export type CustomerFormPrefill = Partial<
  Pick<CustomerFormValues, "email" | "firstName" | "lastName" | "phone">
>;
