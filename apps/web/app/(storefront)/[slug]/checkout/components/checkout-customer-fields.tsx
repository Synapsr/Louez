"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import type { CheckoutProfileField, CustomerFieldPublic } from "@louez/validations";

import type { CustomerProfileFormValues } from "@/components/storefront/customer-fields/customer-fields.types";
import { CustomerFieldFormInput } from "@/components/storefront/customer-fields/customer-field-form-input";
import { CustomerFieldSections } from "@/components/storefront/customer-fields/customer-field-sections";
import { ProfileFieldFormInput } from "@/components/storefront/customer-fields/profile-field-form-input";
import { ProfileFieldsSection } from "@/components/storefront/customer-fields/profile-fields-section";
import { toProfileFieldName } from "@/components/storefront/customer-fields/util.customer-profile-fields";
import { withForm } from "@/hooks/form/form";

import { hasEveryAskedValueOnFile, toCustomerFieldName } from "../util.checkout-custom-fields";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";
import { CheckoutSavedFieldsSummary } from "./checkout-saved-fields-summary";

interface CheckoutCustomerFieldsProps {
  /** Native profile fields this cart asks (birth date, source, links), in the record's order. */
  profileFields: CheckoutProfileField[];
  /** Customer-scope fields this cart asks the buyer's type. */
  fields: CustomerFieldPublic[];
  /** Values the signed-in customer has on file; empty for a guest. */
  savedValues: Record<string, string>;
  /** Native values the signed-in customer has on file; blank for a guest. */
  savedProfile: CustomerProfileFormValues;
}

/**
 * The store's own questions on the contact step: the native profile fields
 * first ("Profil"), then one group per section. A returning customer who
 * already answered all of them sees a single line instead: nothing to
 * retype, and still one tap away from changing it.
 */
export const CheckoutCustomerFields = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutCustomerFieldsProps>(),
  render: ({ form, profileFields, fields, savedValues, savedProfile }) => {
    const t = useTranslations("storefront.customerFields");
    const [isEditingSaved, setIsEditingSaved] = useState(false);

    if (profileFields.length === 0 && fields.length === 0) return null;

    if (
      !isEditingSaved &&
      hasEveryAskedValueOnFile({
        profileFields,
        customerFields: fields,
        savedProfile,
        savedValues,
      })
    ) {
      return (
        <CheckoutSavedFieldsSummary
          fields={[
            ...profileFields.map((field) => ({
              id: field.key,
              label: t(`profile.${field.key}`),
            })),
            ...fields,
          ]}
          onEdit={() => setIsEditingSaved(true)}
        />
      );
    }

    return (
      <div className="flex flex-col gap-6 pt-2">
        {profileFields.length > 0 && (
          <ProfileFieldsSection>
            {profileFields.map((field) => (
              <form.AppField key={field.key} name={toProfileFieldName(field.key)}>
                {() => <ProfileFieldFormInput field={field} />}
              </form.AppField>
            ))}
          </ProfileFieldsSection>
        )}
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
