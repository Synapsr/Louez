"use client";

import { useState } from "react";
import { z } from "zod";
import { CheckoutAddressFields } from "@/app/(storefront)/[slug]/checkout/components/checkout-address-fields";
import { CheckoutBusinessFields } from "@/app/(storefront)/[slug]/checkout/components/checkout-business-fields";
import {
  checkoutFormOptions,
  getCheckoutDefaultValues,
} from "@/app/(storefront)/[slug]/checkout/validator.checkout";
import { useStore } from "@/contexts/store-context";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toastManager } from "@louez/ui";
import { customerProfileMutations } from "@/lib/queries/customer-profile.queries";
import type {
  CheckoutInitialCustomer,
  CheckoutFormValues,
  DeliveryAddress,
} from "@/app/(storefront)/[slug]/checkout/checkout.types";
import { useAppForm } from "@/hooks/form/form";
import { createCustomerProfileSchema } from "@/lib/customer-auth/validator.customer-profile";

export const CustomerProfileForm = ({
  initialCustomer,
  storeSlug,
  country,
}: {
  initialCustomer: CheckoutInitialCustomer;
  storeSlug: string;
  country: string;
}) => {
  const t = useTranslations();
  const router = useRouter();
  const { storeId } = useStore();
  const [coordinates, setCoordinates] = useState<Pick<DeliveryAddress, "latitude" | "longitude">>({
    latitude: null,
    longitude: null,
  });
  const validator: z.ZodType<CheckoutFormValues, CheckoutFormValues> = z
    .custom<CheckoutFormValues>()
    .superRefine((value, ctx) => {
      const result = createCustomerProfileSchema(country).safeParse(value);
      if (!result.success)
        for (const issue of result.error.issues)
          ctx.addIssue({
            code: "custom",
            path: issue.path,
            message: t("storefront.account.profile.invalidData"),
          });
    });
  const save = useMutation({
    ...customerProfileMutations.update(),
    onSuccess: (result) => {
      if (!result.ok) {
        toastManager.add({ title: t("storefront.account.profile.saveError"), type: "error" });
        return;
      }
      toastManager.add({ title: t("storefront.account.profile.saved"), type: "success" });
      router.refresh();
    },
    onError: () => {
      toastManager.add({ title: t("storefront.account.profile.saveError"), type: "error" });
    },
  });
  const form = useAppForm({
    ...checkoutFormOptions,
    defaultValues: getCheckoutDefaultValues(initialCustomer),
    validators: { onSubmit: validator },
    onSubmit: async ({ value }) => {
      await save.mutateAsync({ storeSlug, profile: value }).catch(() => undefined);
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-4">
        <form.AppField name="email">
          {(field) => (
            <field.Input
              label={t("storefront.checkout.email")}
              type="email"
              inputMode="email"
              autoComplete="email"
              className="h-11 text-base sm:h-9 sm:text-sm"
              readOnly
              description={t("storefront.account.profile.emailHelp")}
            />
          )}
        </form.AppField>
        <div className="grid gap-3 sm:grid-cols-2">
          <form.AppField name="firstName">
            {(field) => (
              <field.Input
                label={t("storefront.checkout.firstName")}
                placeholder={t("storefront.checkout.firstNamePlaceholder")}
                autoComplete="given-name"
                className="h-11 text-base sm:h-9 sm:text-sm"
              />
            )}
          </form.AppField>
          <form.AppField name="lastName">
            {(field) => (
              <field.Input
                label={t("storefront.checkout.lastName")}
                placeholder={t("storefront.checkout.lastNamePlaceholder")}
                autoComplete="family-name"
                className="h-11 text-base sm:h-9 sm:text-sm"
              />
            )}
          </form.AppField>
        </div>
        <form.AppField name="phone">
          {(field) => (
            <field.PhoneInput
              label={t("storefront.checkout.phone")}
              placeholder={t("storefront.checkout.phonePlaceholder")}
            />
          )}
        </form.AppField>
        <CheckoutAddressFields
          form={form}
          coordinates={coordinates}
          onCoordinatesChange={setCoordinates}
        />
        <form.AppField name="isBusinessCustomer">
          {(field) => (
            <field.Checkbox
              label={t("storefront.checkout.isBusinessCustomer")}
              className="flex min-h-11 items-center gap-2"
            />
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.isBusinessCustomer}>
          {(isBusiness) =>
            isBusiness && <CheckoutBusinessFields form={form} storeId={storeId} country={country} />
          }
        </form.Subscribe>
        <form.SubscribeButton className="self-start" type="submit">
          {t("common.save")}
        </form.SubscribeButton>
      </form.Form>
    </form.AppForm>
  );
};
