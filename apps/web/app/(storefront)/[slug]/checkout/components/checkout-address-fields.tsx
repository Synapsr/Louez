"use client";

import { useTranslations } from "next-intl";

import { Label } from "@louez/ui";

import { AddressInput } from "@/components/ui/address-input";
import { withForm } from "@/hooks/form/form";
import { getFieldError } from "@/hooks/form/form-context";

import type { DeliveryAddress } from "../checkout.types";
import { getCustomerAddressFields } from "../util.customer-address";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";

interface CheckoutAddressFieldsProps {
  /** Coordinates of the typed address; kept outside the form (not submitted). */
  coordinates: Pick<DeliveryAddress, "latitude" | "longitude">;
  onCoordinatesChange: (coordinates: Pick<DeliveryAddress, "latitude" | "longitude">) => void;
}

/** Customer address: autocomplete line, then postal code and city filled from it. */
export const CheckoutAddressFields = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutAddressFieldsProps>(),
  render: ({ form, coordinates, onCoordinatesChange }) => {
    const t = useTranslations("storefront.checkout");

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
                  onChange={(address, latitude, longitude) => {
                    field.handleChange(address);
                    onCoordinatesChange({ latitude, longitude });
                    if (latitude === null && longitude === null) {
                      form.setFieldValue("postalCode", "");
                      form.setFieldValue("city", "");
                    }
                  }}
                  onAddressResolved={(details) => {
                    const addressFields = getCustomerAddressFields(details);
                    field.handleChange(addressFields.address);
                    form.setFieldValue("postalCode", addressFields.postalCode);
                    form.setFieldValue("city", addressFields.city);
                  }}
                  onBlur={field.handleBlur}
                  placeholder={t("addressPlaceholder")}
                  ariaInvalid={hasError}
                  showMapPicker={false}
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
