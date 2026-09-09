"use client";

import { useStore } from "@tanstack/react-form";
import { ArrowRight, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Collapsible, CollapsiblePanel, CollapsibleTrigger, StepActions } from "@louez/ui";

import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { buildLoginPath } from "@/lib/customer-auth/util.account-redirect";

import { withForm } from "@/hooks/form/form";

import type { CheckoutInitialCustomer, DeliveryAddress } from "../checkout.types";
import { STEP_ACTIONS_CLASS } from "../util.checkout-steps";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";
import { CheckoutAddressFields } from "./checkout-address-fields";
import { CheckoutBusinessFields } from "./checkout-business-fields";

const IS_DEVELOPMENT = process.env.NODE_ENV === "development";
const INPUT_CLASS = "h-11 text-base sm:h-9 sm:text-sm";

interface CheckoutContactStepProps {
  storeId: string;
  /** ISO-2 country of the store — drives the company identifier fields. */
  storeCountry: string;
  /** Whether the store requires the customer address. */
  showAddressFields: boolean;
  sessionCustomer: CheckoutInitialCustomer | null;
  onSessionCustomer: (customer: CheckoutInitialCustomer | null) => void;
  coordinates: Pick<DeliveryAddress, "latitude" | "longitude">;
  onCoordinatesChange: (coordinates: Pick<DeliveryAddress, "latitude" | "longitude">) => void;
  onContinue: () => void;
}

export const CheckoutContactStep = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutContactStepProps>(),
  render: ({
    form,
    storeId,
    storeCountry,
    showAddressFields,
    sessionCustomer,
    onSessionCustomer,
    coordinates,
    onCoordinatesChange,
    onContinue,
  }) => {
    const t = useTranslations("storefront.checkout");
    const isBusinessCustomer = useStore(form.store, (state) => state.values.isBusinessCustomer);
    const hasNotes = useStore(form.store, (state) => state.values.notes.length > 0);

    const handleDevAutofill = () => {
      onCoordinatesChange({ latitude: null, longitude: null });
      form.setFieldValue("firstName", "Teo");
      form.setFieldValue("lastName", "Lumy");
      form.setFieldValue("email", "teo+@lumy.bzh");
      form.setFieldValue("phone", "+33612345678");
      form.setFieldValue("isBusinessCustomer", false);
      form.setFieldValue("address", "1 rue de la Location");
      form.setFieldValue("postalCode", "75001");
      form.setFieldValue("city", "Paris");
      form.setFieldValue("acceptCgv", true);
    };

    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
              {t("steps.contact")}
            </h2>
            {!sessionCustomer && (
              <p className="text-sm text-muted-foreground">
                {t.rich("returningCustomer.loginLink", {
                  signin: (chunks) => (
                    <StorefrontLink
                      href={buildLoginPath({ redirect: "/checkout" })}
                      prefetch={false}
                      className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {chunks}
                    </StorefrontLink>
                  ),
                })}
              </p>
            )}
          </div>
          {IS_DEVELOPMENT && (
            <Button type="button" variant="outline" size="sm" onClick={handleDevAutofill}>
              <Wand2 data-slot="icon" />
              Remplir dev
            </Button>
          )}
        </div>

        {sessionCustomer && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="truncate">
              {t("returningCustomer.signedInAs", {
                name:
                  `${sessionCustomer.firstName} ${sessionCustomer.lastName}`.trim() ||
                  sessionCustomer.email,
              })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              onClick={() => onSessionCustomer(null)}
            >
              {t("returningCustomer.notYou")}
            </Button>
          </div>
        )}

        <form.AppField name="email">
          {(field) => (
            <field.Input
              label={t("email")}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              className={INPUT_CLASS}
            />
          )}
        </form.AppField>

        <div className="grid gap-3 sm:grid-cols-2">
          <form.AppField name="firstName">
            {(field) => (
              <field.Input
                label={t("firstName")}
                placeholder={t("firstNamePlaceholder")}
                autoComplete="given-name"
                className={INPUT_CLASS}
              />
            )}
          </form.AppField>
          <form.AppField name="lastName">
            {(field) => (
              <field.Input
                label={t("lastName")}
                placeholder={t("lastNamePlaceholder")}
                autoComplete="family-name"
                className={INPUT_CLASS}
              />
            )}
          </form.AppField>
        </div>

        <form.AppField name="phone">
          {(field) => (
            <field.PhoneInput
              label={t("phone")}
              placeholder={t("phonePlaceholder")}
              autoComplete="tel"
            />
          )}
        </form.AppField>

        {showAddressFields && (
          <CheckoutAddressFields
            form={form}
            coordinates={coordinates}
            onCoordinatesChange={onCoordinatesChange}
          />
        )}

        <form.AppField name="isBusinessCustomer">
          {(field) => (
            <field.Checkbox
              label={t("isBusinessCustomer")}
              className="flex min-h-11 items-center gap-2"
            />
          )}
        </form.AppField>

        {isBusinessCustomer && (
          <CheckoutBusinessFields form={form} storeId={storeId} country={storeCountry} />
        )}

        <Collapsible defaultOpen={hasNotes}>
          <CollapsibleTrigger className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground">
            {t("notesDisclosure")}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-3">
              <form.AppField name="notes">
                {(field) => (
                  <field.Textarea
                    label={t("notes")}
                    placeholder={t("notesPlaceholder")}
                    rows={3}
                    className="text-base sm:text-sm"
                  />
                )}
              </form.AppField>
            </div>
          </CollapsiblePanel>
        </Collapsible>

        <StepActions className={STEP_ACTIONS_CLASS}>
          <Button
            type="button"
            size="lg"
            onClick={onContinue}
            className="h-12 w-full lg:h-10 lg:w-auto lg:ml-auto"
          >
            {t("continue")}
            <ArrowRight data-slot="icon" />
          </Button>
        </StepActions>
      </div>
    );
  },
});
