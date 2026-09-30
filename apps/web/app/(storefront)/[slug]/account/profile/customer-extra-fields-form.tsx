"use client";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";
import type {
  CheckoutProfileField,
  CustomerExtraLayoutItem,
  CustomerFieldAccount,
  CustomerProfileValues,
} from "@louez/validations";

import { CustomerExtraFieldsGrid } from "@/components/storefront/customer-fields/customer-extra-fields-grid";
import { CustomerFieldFormInput } from "@/components/storefront/customer-fields/customer-field-form-input";
import { ProfileFieldFormInput } from "@/components/storefront/customer-fields/profile-field-form-input";
import { useCustomerFieldIssueMessage } from "@/components/storefront/customer-fields/use-customer-field-issue-message";
import { joinCustomerExtraLayout } from "@/components/storefront/customer-fields/util.customer-extra-layout";
import { readCustomerFieldIssues } from "@/components/storefront/customer-fields/util.customer-field-issues";
import {
  readCustomerProfileFieldIssues,
  toCustomerProfileFormValues,
  toCustomerProfileValuesInput,
  toProfileFieldName,
} from "@/components/storefront/customer-fields/util.customer-profile-fields";
import { useAppForm } from "@/hooks/form/form";
import { orpc } from "@/lib/orpc/react";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { createCustomerExtraFieldsSchema } from "./validator.customer-extra-fields";

interface CustomerExtraFieldsFormProps {
  /** The native fields the customer may edit (birth date, source, links). */
  profileFields: CheckoutProfileField[];
  profile: CustomerProfileValues;
  /** The custom fields the customer may edit, already narrowed to their type. */
  fields: CustomerFieldAccount[];
  values: Record<string, string>;
  /** How the owner laid the fields out: one list, native and custom interleaved. */
  layout: CustomerExtraLayoutItem[];
}

/**
 * Edits the native and custom fields a customer owns; only their keys are
 * sent, a blank clears an optional one.
 */
export const CustomerExtraFieldsForm = ({
  profileFields,
  profile,
  fields,
  values,
  layout,
}: CustomerExtraFieldsFormProps) => {
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
      profileFields: toCustomerProfileFormValues(profile),
      values: Object.fromEntries(fields.map((field) => [field.id, values[field.id] ?? ""])),
    },
    validators: {
      onSubmit: createCustomerExtraFieldsSchema(profileFields, fields, issueMessage),
    },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync({
          values: Object.fromEntries(
            fields.map((field) => [field.id, value.values[field.id] ?? ""]),
          ),
          ...(profileFields.length > 0
            ? { profile: toCustomerProfileValuesInput(value.profileFields, profileFields) }
            : {}),
        });
      } catch (error) {
        const issues = readCustomerFieldIssues(error);
        const profileIssues = readCustomerProfileFieldIssues(error);
        for (const issue of profileIssues) {
          formApi.setFieldMeta(toProfileFieldName(issue.field), (prev) => ({
            ...prev,
            isTouched: true,
            errorMap: { ...prev.errorMap, onServer: issueMessage(issue.code) },
          }));
        }
        for (const issue of issues) {
          formApi.setFieldMeta(`values.${issue.definitionId}`, (prev) => ({
            ...prev,
            isTouched: true,
            errorMap: { ...prev.errorMap, onServer: issueMessage(issue.code) },
          }));
        }
        const key = getErrorMessageKey(error);
        const hasFieldIssues = issues.length > 0 || profileIssues.length > 0;
        toastManager.add({
          title: hasFieldIssues || !tErrors.has(key) ? t("saveError") : tErrors(key),
          type: "error",
        });
      }
    },
  });

  return (
    <form.AppForm>
      <form.Form className="mt-4 flex flex-col gap-6">
        <CustomerExtraFieldsGrid
          items={joinCustomerExtraLayout(layout, profileFields, fields)}
          renderItem={(item) =>
            item.kind === "builtin" ? (
              <form.AppField name={toProfileFieldName(item.key)}>
                {() => <ProfileFieldFormInput field={item.field} />}
              </form.AppField>
            ) : (
              <form.AppField name={`values.${item.field.id}`}>
                {() => <CustomerFieldFormInput field={item.field} />}
              </form.AppField>
            )
          }
        />
        <form.SubscribeButton type="submit" className="self-start">
          {tCommon("save")}
        </form.SubscribeButton>
      </form.Form>
    </form.AppForm>
  );
};
