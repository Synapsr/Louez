import type { CustomerAccountFields } from "@louez/api/services/customer-profile-fields";

import type { CustomerProfileFormValues } from "@/components/storefront/customer-fields/customer-fields.types";

/**
 * `storefront.customerFields.myValues`: the fields a checkout may ask
 * (native and custom), the customer's values and how the form lays them out.
 */
export type CustomerExtraFieldsData = CustomerAccountFields;

export interface CustomerExtraFieldsFormValues {
  profileFields: CustomerProfileFormValues;
  values: Record<string, string>;
}
