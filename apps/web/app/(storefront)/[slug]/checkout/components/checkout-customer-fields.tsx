"use client";

import { useState } from "react";

import type { CustomerFieldPublic } from "@louez/validations";

import { CustomerFieldFormInput } from "@/components/storefront/customer-fields/customer-field-form-input";
import { CustomerFieldSections } from "@/components/storefront/customer-fields/customer-field-sections";
import { withForm } from "@/hooks/form/form";

import { hasEveryCustomerFieldOnFile, toCustomerFieldName } from "../util.checkout-custom-fields";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";
import { CheckoutSavedFieldsSummary } from "./checkout-saved-fields-summary";

interface CheckoutCustomerFieldsProps {
  /** Customer-scope fields this cart asks the buyer's type. */
  fields: CustomerFieldPublic[];
  /** Values the signed-in customer has on file; empty for a guest. */
  savedValues: Record<string, string>;
}

/**
 * The store's own questions on the contact step, one group per section. A
 * returning customer who already answered all of them sees a single line
 * instead: nothing to retype, and still one tap away from changing it.
 */
export const CheckoutCustomerFields = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutCustomerFieldsProps>(),
  render: ({ form, fields, savedValues }) => {
    const [isEditingSaved, setIsEditingSaved] = useState(false);

    if (fields.length === 0) return null;

    if (!isEditingSaved && hasEveryCustomerFieldOnFile(fields, savedValues)) {
      return <CheckoutSavedFieldsSummary fields={fields} onEdit={() => setIsEditingSaved(true)} />;
    }

    return (
      <div className="flex flex-col gap-6 pt-2">
        <CustomerFieldSections
          fields={fields}
          renderField={(field) => (
            <form.AppField name={toCustomerFieldName(field.id)}>
              {() => <CustomerFieldFormInput field={field} />}
            </form.AppField>
          )}
        />
      </div>
    );
  },
});
