"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import type {
  CheckoutProfileField,
  CustomerExtraLayoutItem,
  CustomerFieldPublic,
} from "@louez/validations";

import type { CustomerProfileFormValues } from "@/components/storefront/customer-fields/customer-fields.types";
import { CustomerExtraFieldsGrid } from "@/components/storefront/customer-fields/customer-extra-fields-grid";
import { CustomerFieldFormInput } from "@/components/storefront/customer-fields/customer-field-form-input";
import { ProfileFieldFormInput } from "@/components/storefront/customer-fields/profile-field-form-input";
import { joinCustomerExtraLayout } from "@/components/storefront/customer-fields/util.customer-extra-layout";
import { toProfileFieldName } from "@/components/storefront/customer-fields/util.customer-profile-fields";
import { withForm } from "@/hooks/form/form";

import { hasEveryAskedValueOnFile, toCustomerFieldName } from "../util.checkout-custom-fields";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";
import { CheckoutSavedFieldsSummary } from "./checkout-saved-fields-summary";

interface CheckoutCustomerFieldsProps {
  /** Native profile fields this cart asks (birth date, source, links). */
  profileFields: CheckoutProfileField[];
  /** Customer-scope fields this cart asks the buyer's type. */
  fields: CustomerFieldPublic[];
  /** How the owner laid them out: one list, native and custom interleaved. */
  layout: CustomerExtraLayoutItem[];
  /** Values the signed-in customer has on file; empty for a guest. */
  savedValues: Record<string, string>;
  /** Native values the signed-in customer has on file; blank for a guest. */
  savedProfile: CustomerProfileFormValues;
}

/**
 * The store's own questions on the contact step, native and custom, in the
 * owner's layout. A returning customer who already answered all of them sees
 * a single line instead: nothing to retype, and still one tap away from
 * changing it.
 */
export const CheckoutCustomerFields = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutCustomerFieldsProps>(),
  render: ({ form, profileFields, fields, layout, savedValues, savedProfile }) => {
    const t = useTranslations("storefront.customerFields");
    const [isEditingSaved, setIsEditingSaved] = useState(false);
    const items = joinCustomerExtraLayout(layout, profileFields, fields);

    if (items.length === 0) return null;

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
          fields={items.map((item) =>
            item.kind === "builtin"
              ? { id: item.key, label: t(`profile.${item.key}`) }
              : item.field,
          )}
          onEdit={() => setIsEditingSaved(true)}
        />
      );
    }

    return (
      <CustomerExtraFieldsGrid
        className="pt-2"
        items={items}
        renderItem={(item) =>
          item.kind === "builtin" ? (
            <form.AppField name={toProfileFieldName(item.key)}>
              {() => <ProfileFieldFormInput field={item.field} />}
            </form.AppField>
          ) : (
            <form.AppField name={toCustomerFieldName(item.field.id)}>
              {() => <CustomerFieldFormInput field={item.field} />}
            </form.AppField>
          )
        }
      />
    );
  },
});
