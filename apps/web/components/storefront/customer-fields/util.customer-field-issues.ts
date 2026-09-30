import type { CustomerFieldDefinition, CustomerFieldValues } from "@louez/types";
import {
  customerFieldIssueSchema,
  normalizeCustomerFieldValue,
  reservationItemDetailIssueSchema,
  type CustomerFieldIssue,
  type ReservationItemDetailIssue,
} from "@louez/validations";
import { z } from "zod";

type CheckedField = Pick<
  CustomerFieldDefinition,
  "id" | "type" | "format" | "options" | "collectMode"
>;

/**
 * What a customer's account form may not send, checked like
 * `storefront.customerFields.updateMyValues` does: a value that cannot be
 * stored, or a field the store requires left empty.
 */
export const getCustomerFieldValueIssues = (
  fields: readonly CheckedField[],
  values: CustomerFieldValues,
): CustomerFieldIssue[] =>
  fields.flatMap((field): CustomerFieldIssue[] => {
    const result = normalizeCustomerFieldValue(field, values[field.id]);
    if ("code" in result) return [{ definitionId: field.id, code: result.code }];
    return result.value === "" && field.collectMode === "required"
      ? [{ definitionId: field.id, code: "required" }]
      : [];
  });

const customerFieldIssuesErrorSchema = z.object({
  data: z.object({ issues: z.array(customerFieldIssueSchema) }),
});

const reservationItemDetailIssuesErrorSchema = z.object({
  data: z.object({ issues: z.array(reservationItemDetailIssueSchema) }),
});

/** `data.issues` of an `errors.customFieldsInvalid` refusal of `updateMyValues`; empty for any other error. */
export const readCustomerFieldIssues = (error: unknown): CustomerFieldIssue[] => {
  const parsed = customerFieldIssuesErrorSchema.safeParse(error);
  return parsed.success ? parsed.data.data.issues : [];
};

/** Same for `updateReservationDetails`: each issue names the item and the unit. */
export const readReservationItemDetailIssues = (error: unknown): ReservationItemDetailIssue[] => {
  const parsed = reservationItemDetailIssuesErrorSchema.safeParse(error);
  return parsed.success ? parsed.data.data.issues : [];
};
