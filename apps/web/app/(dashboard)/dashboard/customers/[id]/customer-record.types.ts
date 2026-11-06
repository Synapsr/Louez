import type {
  CustomerAcquisitionSource,
  CustomerCreatedVia,
  CustomerSocialLinks,
} from "@louez/types";

/** What the side column of the customer record shows and edits. */
export interface CustomerRecord {
  id: string;
  customerType: "individual" | "business";
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  birthDate: string | null;
  acquisitionSource: CustomerAcquisitionSource | null;
  acquisitionSourceDetail: string | null;
  createdVia: CustomerCreatedVia | null;
  socialLinks: CustomerSocialLinks | null;
}

/** Which card is being edited: a native block, or a custom section by its name. */
export type CustomerRecordSection =
  | { kind: "contact" }
  | { kind: "profile" }
  | { kind: "custom"; name: string };
