import { hasSuspiciousIdentityValue } from "@louez/validations";

import type { StorefrontCustomerField } from "./customer-fields.types";

export type CustomerFieldHintField = Pick<StorefrontCustomerField, "helpText" | "format">;

/**
 * The one line under a custom field: the error, else a warning on an
 * identifier that looks wrong, else the store's help text. One line at a time
 * keeps a form of several fields readable.
 */
export const getCustomerFieldHintKind = (
  field: CustomerFieldHintField,
  value: string,
  error?: string,
) => {
  if (error) return "error";
  if (hasSuspiciousIdentityValue(field.format, value)) return "warning";
  if (field.helpText) return "help";
  return null;
};
