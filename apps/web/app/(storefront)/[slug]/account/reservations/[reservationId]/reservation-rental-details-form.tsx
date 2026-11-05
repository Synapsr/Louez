"use client";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import { CustomerFieldFormInput } from "@/components/storefront/customer-fields/customer-field-form-input";
import { RentalUnitCard } from "@/components/storefront/customer-fields/rental-unit-card";
import { RentalUnitParticipantInput } from "@/components/storefront/customer-fields/rental-unit-participant-input";
import { RentalUnitRecap } from "@/components/storefront/customer-fields/rental-unit-recap";
import { useCustomerFieldIssueMessage } from "@/components/storefront/customer-fields/use-customer-field-issue-message";
import { readReservationItemDetailIssues } from "@/components/storefront/customer-fields/util.customer-field-issues";
import { useAppForm } from "@/hooks/form/form";
import { orpc } from "@/lib/orpc/react";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import type { RentalDetailsItem } from "./reservation-rental-details.types";
import {
  buildRentalDetailsUpdate,
  getEditableFields,
  getRentalDetailsDefaultValues,
  getRentalDetailsIssueName,
  toRentalUnitKey,
  toRentalUnitValueName,
} from "./util.rental-details-form";
import { createRentalDetailsSchema } from "./validator.rental-details";

interface ReservationRentalDetailsFormProps {
  reservationId: string;
  items: RentalDetailsItem[];
  onDone: () => void;
}

/**
 * Edits "Détails de la location" before the rental starts, with the checkout's
 * own unit cards. What the store recorded and the customer may not change
 * stays visible, read-only, under the inputs.
 */
export const ReservationRentalDetailsForm = ({
  reservationId,
  items,
  onDone,
}: ReservationRentalDetailsFormProps) => {
  const t = useTranslations("storefront.account.rentalDetails");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const issueMessage = useCustomerFieldIssueMessage();
  const queryClient = useQueryClient();
  const detailsOptions = orpc.storefront.customerFields.reservationDetails.queryOptions({
    input: { reservationId },
  });

  const save = useMutation(
    orpc.storefront.customerFields.updateReservationDetails.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(detailsOptions.queryKey, next);
        toastManager.add({ title: t("saved"), type: "success" });
        onDone();
      },
    }),
  );

  const form = useAppForm({
    defaultValues: getRentalDetailsDefaultValues(items),
    validators: { onSubmit: createRentalDetailsSchema(items, issueMessage) },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(buildRentalDetailsUpdate(reservationId, items, value));
      } catch (error) {
        const issues = readReservationItemDetailIssues(error);
        for (const issue of issues) {
          formApi.setFieldMeta(getRentalDetailsIssueName(issue), (prev) => ({
            ...prev,
            isTouched: true,
            errorMap: { ...prev.errorMap, onServer: issueMessage(issue.code) },
          }));
        }
        const key = getErrorMessageKey(error);
        toastManager.add({
          title: issues.length === 0 && tErrors.has(key) ? tErrors(key) : t("saveError"),
          type: "error",
        });
        // Locked meanwhile (the rental started): show what is now the truth.
        if (key === "reservationDetailsLocked") {
          void queryClient.invalidateQueries({ queryKey: detailsOptions.queryKey });
          onDone();
        }
      }
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-4">
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {items.flatMap((item) => {
            const editable = getEditableFields(item);
            const readOnly = item.fields.filter((field) => !field.customerEditable);
            return item.units.map((unit) => {
              const unitKey = toRentalUnitKey(item.reservationItemId, unit.unitIndex);
              return (
                <RentalUnitCard
                  key={unitKey}
                  productName={item.productName}
                  productImage={item.productImage}
                  unitIndex={unit.unitIndex}
                  quantity={item.quantity}
                >
                  {editable.length > 0 ? (
                    <div className="grid items-start gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <form.AppField name={`units.${unitKey}.participantName`}>
                          {() => <RentalUnitParticipantInput />}
                        </form.AppField>
                      </div>
                      {editable.map((field) => (
                        <div
                          key={field.id}
                          className={cn("min-w-0", field.width === "full" && "sm:col-span-2")}
                        >
                          <form.AppField name={toRentalUnitValueName(unitKey, field.id)}>
                            {() => <CustomerFieldFormInput field={field} />}
                          </form.AppField>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {readOnly.some((field) => unit.values[field.id]) && (
                    <RentalUnitRecap
                      fields={readOnly}
                      participantName={editable.length > 0 ? null : unit.participantName}
                      values={unit.values}
                    />
                  )}
                </RentalUnitCard>
              );
            });
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <form.SubscribeButton type="submit">{tCommon("save")}</form.SubscribeButton>
          <Button type="button" variant="ghost" onClick={onDone}>
            {tCommon("cancel")}
          </Button>
        </div>
      </form.Form>
    </form.AppForm>
  );
};
