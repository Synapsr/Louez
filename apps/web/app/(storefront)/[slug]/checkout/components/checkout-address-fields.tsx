"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { Label } from "@louez/ui";

import { AddressInput } from "@/components/ui/address-input";
import { withForm } from "@/hooks/form/form";
import { getFieldError } from "@/hooks/form/form-context";

import {
  CUSTOMER_ADDRESS_RESOLVES_TYPED_TEXT,
  type CustomerAddressPick,
  getCustomerAddressFields,
  getLocalityAfterStreetEdit,
  getPickedCoordinates,
} from "../util.customer-address";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";

interface CheckoutAddressFieldsProps {
  /** The suggestion last picked, with its coordinates; kept outside the form (not submitted). */
  pick: CustomerAddressPick | null;
  onPickChange: (pick: CustomerAddressPick | null) => void;
}

/** Customer address: autocomplete line, then postal code and city, filled from a picked suggestion. */
export const CheckoutAddressFields = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutAddressFieldsProps>(),
  render: ({ form, pick, onPickChange }) => {
    const t = useTranslations("storefront.checkout");
    const address = useStore(form.store, (state) => state.values.address);
    const postalCode = useStore(form.store, (state) => state.values.postalCode);
    const city = useStore(form.store, (state) => state.values.city);
    const coordinates = getPickedCoordinates(pick, { address, postalCode, city });

    return (
      <div className="flex flex-col gap-3">
        <form.Field name="address">
          {(field) => {
            const hasError = field.state.meta.errors.length > 0;
            return (
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor={field.name} data-error={hasError}>
                  {t("address")}
                </Label>
                <AddressInput
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  displayAddress={field.state.value}
                  latitude={coordinates.latitude}
                  longitude={coordinates.longitude}
                  onChange={(nextAddress, latitude) => {
                    field.handleChange(nextAddress);
                    // With coordinates, a pick is landing: onAddressResolved fills the fields.
                    if (latitude !== null) return;
                    // The street was edited: postal code and city the pick filled go
                    // stale; typed or autofilled ones stay.
                    const locality = getLocalityAfterStreetEdit(pick, {
                      address: nextAddress,
                      postalCode: form.getFieldValue("postalCode"),
                      city: form.getFieldValue("city"),
                    });
                    form.setFieldValue("postalCode", locality.postalCode);
                    form.setFieldValue("city", locality.city);
                    if (pick) onPickChange(null);
                  }}
                  onAddressResolved={(details) => {
                    const fields = getCustomerAddressFields(details);
                    field.handleChange(fields.address);
                    form.setFieldValue("postalCode", fields.postalCode);
                    form.setFieldValue("city", fields.city);
                    onPickChange({
                      fields,
                      latitude: details.latitude,
                      longitude: details.longitude,
                    });
                  }}
                  resolvesTypedText={CUSTOMER_ADDRESS_RESOLVES_TYPED_TEXT}
                  onBlur={field.handleBlur}
                  placeholder={t("addressPlaceholder")}
                  ariaInvalid={hasError}
                  showMapPicker={false}
                  autoComplete="address-line1"
                />
                {hasError && (
                  <p className="text-xs text-destructive">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            );
          }}
        </form.Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <form.AppField name="postalCode">
            {(field) => (
              <field.Input
                label={t("postalCode")}
                placeholder={t("postalCodePlaceholder")}
                inputMode="numeric"
                autoComplete="postal-code"
              />
            )}
          </form.AppField>
          <form.AppField name="city">
            {(field) => (
              <field.Input
                label={t("city")}
                placeholder={t("cityPlaceholder")}
                autoComplete="address-level2"
              />
            )}
          </form.AppField>
        </div>
      </div>
    );
  },
});
