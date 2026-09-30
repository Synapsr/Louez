import type { CustomerFieldIssueCode } from "@louez/validations";
import { z } from "zod";

import { getCustomerFieldValueIssues } from "@/components/storefront/customer-fields/util.customer-field-issues";

import type { CustomerExtraFieldsFormValues } from "./customer-extra-fields.types";

type CheckedField = Parameters<typeof getCustomerFieldValueIssues>[0][number];

/** The profile's "Informations complémentaires", checked with the rules the server applies. */
export const createCustomerExtraFieldsSchema = (
  fields: readonly CheckedField[],
  issueMessage: (code: CustomerFieldIssueCode) => string,
): z.ZodType<CustomerExtraFieldsFormValues, CustomerExtraFieldsFormValues> =>
  z.object({ values: z.record(z.string(), z.string()) }).superRefine((data, ctx) => {
    for (const issue of getCustomerFieldValueIssues(fields, data.values)) {
      ctx.addIssue({
        code: "custom",
        message: issueMessage(issue.code),
        path: ["values", issue.definitionId],
      });
    }
  });
