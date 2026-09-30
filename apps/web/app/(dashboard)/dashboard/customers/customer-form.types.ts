import type { CustomerAcquisitionSource, CustomerSocialLinks } from "@louez/types";

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
