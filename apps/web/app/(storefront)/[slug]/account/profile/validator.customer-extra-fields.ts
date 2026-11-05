import { CUSTOMER_SOCIAL_NETWORKS } from "@louez/types";
import type { CheckoutProfileField, CustomerFieldIssueCode } from "@louez/validations";
import { z } from "zod";

import { getCustomerFieldValueIssues } from "@/components/storefront/customer-fields/util.customer-field-issues";
import { getCustomerProfileFormIssues } from "@/components/storefront/customer-fields/util.customer-profile-fields";

import type { CustomerExtraFieldsFormValues } from "./customer-extra-fields.types";

type CheckedField = Parameters<typeof getCustomerFieldValueIssues>[0][number];

/**
 * The profile's "Informations complémentaires", checked with the rules the
 * server applies: native fields first, then the store's own.
 */
export const createCustomerExtraFieldsSchema = (
  profileFields: readonly CheckoutProfileField[],
  fields: readonly CheckedField[],
  issueMessage: (code: CustomerFieldIssueCode) => string,
): z.ZodType<CustomerExtraFieldsFormValues, CustomerExtraFieldsFormValues> =>
  z
    .object({
      profileFields: z.object({
        birthDate: z.string(),
        acquisitionSource: z.object({ source: z.string(), detail: z.string() }),
        socialLinks: z.partialRecord(z.enum(CUSTOMER_SOCIAL_NETWORKS), z.string()),
      }),
      values: z.record(z.string(), z.string()),
    })
    .superRefine((data, ctx) => {
      for (const issue of getCustomerProfileFormIssues(data.profileFields, profileFields)) {
        ctx.addIssue({
          code: "custom",
          message: issueMessage(issue.code),
          path: ["profileFields", issue.field],
        });
      }
      for (const issue of getCustomerFieldValueIssues(fields, data.values)) {
        ctx.addIssue({
          code: "custom",
          message: issueMessage(issue.code),
          path: ["values", issue.definitionId],
        });
      }
    });
