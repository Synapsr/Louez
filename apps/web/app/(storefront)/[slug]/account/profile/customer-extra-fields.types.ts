import type {
  AccountProfileField,
  CustomerFieldAccount,
  CustomerProfileValues,
} from "@louez/validations";

import type { CustomerProfileFormValues } from "@/components/storefront/customer-fields/customer-fields.types";

/**
 * `storefront.customerFields.myValues`: the fields a checkout may ask
 * (native and custom) and the customer's values.
 */
export interface CustomerExtraFieldsData {
  customerType: "individual" | "business";
  fields: CustomerFieldAccount[];
  values: Record<string, string>;
  /** Native fields a checkout may ask (birth date, source, links), in the record's order. */
  profileFields: AccountProfileField[];
  profile: CustomerProfileValues;
}

export interface CustomerExtraFieldsFormValues {
  profileFields: CustomerProfileFormValues;
  values: Record<string, string>;
}
