"use client";

import { ArrowRight, ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, StepContent } from "@louez/ui";
import { cn } from "@louez/utils";

import { CustomerFieldFormInput } from "@/components/storefront/customer-fields/customer-field-form-input";
import { RentalUnitCard } from "@/components/storefront/customer-fields/rental-unit-card";
import { RentalUnitParticipantInput } from "@/components/storefront/customer-fields/rental-unit-participant-input";
import { withForm } from "@/hooks/form/form";

import type { CheckoutFieldsLine } from "../checkout.types";
import { toItemFieldName, toParticipantFieldName, toUnitKey } from "../util.checkout-custom-fields";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";
import { CheckoutStepActions } from "./checkout-step-actions";

interface CheckoutDetailsStepProps {
  /** Cart lines; only those asking item fields get cards. */
  lines: CheckoutFieldsLine[];
  storeName: string;
  onBack: () => void;
  onContinue: () => void;
  /** Direction the step flow moved in, for the entrance animation. */
  stepDirection: "forward" | "backward";
}

/**
 * "Détails de la location": one card per rented unit (two bikes, two cards),
 * "Pour qui ?" first so the team knows whose settings these are, then the
 * fields in the owner's layout, each as wide as it was set.
 */
export const CheckoutDetailsStep = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutDetailsStepProps>(),
  render: ({ form, lines, storeName, onBack, onContinue, stepDirection }) => {
    const t = useTranslations("storefront.checkout");
    const askingLines = lines.filter((line) => line.itemFields.length > 0);

    return (
      <>
        <StepContent className="flex flex-col gap-4" direction={stepDirection}>
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
              {t("steps.details")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("customFields.detailsIntro", { store: storeName })}
            </p>
          </div>

          {askingLines.flatMap((line) =>
            Array.from({ length: line.quantity }, (_, unitIndex) => {
              const unitKey = toUnitKey(line.lineId, unitIndex);
              return (
                <RentalUnitCard
                  key={unitKey}
                  productName={line.productName}
                  productImage={line.productImage}
                  unitIndex={unitIndex}
                  quantity={line.quantity}
                >
                  <div className="grid items-start gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <form.AppField name={toParticipantFieldName(unitKey)}>
                        {() => <RentalUnitParticipantInput />}
                      </form.AppField>
                    </div>
                    {line.itemFields.map((field) => (
                      <div
                        key={field.id}
                        className={cn("min-w-0", field.width === "full" && "sm:col-span-2")}
                      >
                        <form.AppField name={toItemFieldName(unitKey, field.id)}>
                          {() => <CustomerFieldFormInput field={field} />}
                        </form.AppField>
                      </div>
                    ))}
                  </div>
                </RentalUnitCard>
              );
            }),
          )}
        </StepContent>

        <CheckoutStepActions>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onBack}
            className="h-12 lg:h-10"
          >
            <ChevronLeft data-slot="icon" />
            {t("back")}
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={onContinue}
            className="h-12 flex-1 lg:h-10 lg:flex-none"
          >
            {t("continue")}
            <ArrowRight data-slot="icon" />
          </Button>
        </CheckoutStepActions>
      </>
    );
  },
});
