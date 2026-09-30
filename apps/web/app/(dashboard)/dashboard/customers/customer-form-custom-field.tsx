"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import type { CustomerFieldIssueCode } from "@louez/validations";

import { CustomerFieldControl } from "@/components/dashboard/customers/customer-field-control";

import type { CustomerFormApi } from "./use-customer-form";

interface CustomerFormCustomFieldProps {
  form: CustomerFormApi;
  definition: CustomerFieldDefinition;
  /** Why the server refused the value, when it did. */
  issue?: CustomerFieldIssueCode;
  /** Record being edited, left out of the duplicate lookup. */
  customerId?: string;
}

/** One of the store's own fields in the customer form, bound to `customFields.<id>`. */
export const CustomerFormCustomField = ({
  form,
  definition,
  issue,
  customerId,
}: CustomerFormCustomFieldProps) => {
  const t = useTranslations("dashboard.customers.fields.issues");

  return (
    <form.Field name={`customFields.${definition.id}`}>
      {(field) => (
        <CustomerFieldControl
          definition={definition}
          customerId={customerId}
          value={field.state.value ?? ""}
          error={issue ? t(issue) : undefined}
          onChange={field.handleChange}
          onBlur={field.handleBlur}
        />
      )}
    </form.Field>
  );
};
