import type { CustomerFieldAccount } from "@louez/validations";

/** `storefront.customerFields.myValues`: the fields a checkout may ask and the customer's values. */
export interface CustomerExtraFieldsData {
  customerType: "individual" | "business";
  fields: CustomerFieldAccount[];
  values: Record<string, string>;
}

export interface CustomerExtraFieldsFormValues {
  values: Record<string, string>;
}
