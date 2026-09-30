"use client";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";
import type { CustomerFieldAccount } from "@louez/validations";

import { CustomerFieldFormInput } from "@/components/storefront/customer-fields/customer-field-form-input";
import { CustomerFieldSections } from "@/components/storefront/customer-fields/customer-field-sections";
import { useCustomerFieldIssueMessage } from "@/components/storefront/customer-fields/use-customer-field-issue-message";
import { readCustomerFieldIssues } from "@/components/storefront/customer-fields/util.customer-field-issues";
import { useAppForm } from "@/hooks/form/form";
import { orpc } from "@/lib/orpc/react";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { createCustomerExtraFieldsSchema } from "./validator.customer-extra-fields";

interface CustomerExtraFieldsFormProps {
  /** The fields the customer may edit, already narrowed to their type. */
  fields: CustomerFieldAccount[];
  values: Record<string, string>;
}

/** Edits the custom fields a customer owns; only their keys are sent, "" clears an optional one. */
export const CustomerExtraFieldsForm = ({ fields, values }: CustomerExtraFieldsFormProps) => {
  const t = useTranslations("storefront.account.profile");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const issueMessage = useCustomerFieldIssueMessage();
  const queryClient = useQueryClient();
  const myValuesOptions = orpc.storefront.customerFields.myValues.queryOptions();

  const save = useMutation(
    orpc.storefront.customerFields.updateMyValues.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(myValuesOptions.queryKey, next);
        toastManager.add({ title: t("saved"), type: "success" });
      },
    }),
  );

  const form = useAppForm({
    defaultValues: {
      values: Object.fromEntries(fields.map((field) => [field.id, values[field.id] ?? ""])),
    },
    validators: { onSubmit: createCustomerExtraFieldsSchema(fields, issueMessage) },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync({
          values: Object.fromEntries(
            fields.map((field) => [field.id, value.values[field.id] ?? ""]),
          ),
        });
      } catch (error) {
        const issues = readCustomerFieldIssues(error);
        for (const issue of issues) {
          formApi.setFieldMeta(`values.${issue.definitionId}`, (prev) => ({
            ...prev,
            isTouched: true,
            errorMap: { ...prev.errorMap, onServer: issueMessage(issue.code) },
          }));
        }
        const key = getErrorMessageKey(error);
        toastManager.add({
          title: issues.length > 0 || !tErrors.has(key) ? t("saveError") : tErrors(key),
          type: "error",
        });
      }
    },
  });

  return (
    <form.AppForm>
      <form.Form className="mt-4 flex flex-col gap-6">
        <CustomerFieldSections
          fields={fields}
          renderField={(field) => (
            <form.AppField name={`values.${field.id}`}>
              {() => <CustomerFieldFormInput field={field} />}
            </form.AppField>
          )}
        />
        <form.SubscribeButton type="submit" className="self-start">
          {tCommon("save")}
        </form.SubscribeButton>
      </form.Form>
    </form.AppForm>
  );
};
