"use client";

import { useState } from "react";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  CUSTOMER_ACQUISITION_SOURCES,
  CUSTOMER_SOCIAL_NETWORKS,
  type CustomerFieldValues,
} from "@louez/types";
import {
  type CustomerFieldIssueCode,
  type CustomerFormLayoutItem,
  isPlausibleBirthDate,
  isPossiblePhoneNumberInput,
} from "@louez/validations";
import { z } from "zod";

import { useAppForm } from "@/hooks/form/form";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { createCustomer, updateCustomer, updateCustomerSection } from "./actions";
import type {
  CustomerFormCustomer,
  CustomerFormPrefill,
  CustomerFormSave,
  CustomerFormValues,
} from "./customer-form.types";
import {
  getCustomerFormDefaults,
  toCustomerInput,
  toCustomerRecordInput,
} from "./util.customer-form";

interface UseCustomerFormParams {
  customer?: CustomerFormCustomer;
  initialCustomFields: CustomerFieldValues;
  prefill?: CustomerFormPrefill;
  /**
   * The items the form shows, hidden ones already left out: they say which
   * Louez fields the store requires, and what the record's Sheet sends.
   */
  items: readonly CustomerFormLayoutItem[];
  save: CustomerFormSave;
  /** Called once saved, with the customer's id (the new one for a creation). */
  onSaved: (customerId: string, values: CustomerFormValues) => void;
}

/**
 * One form for every place a customer is typed in: the new and edit pages,
 * the quick-create dialog and the record's Sheet. Only where it saves and
 * what happens next differ.
 */
export const useCustomerForm = ({
  customer,
  initialCustomFields,
  prefill,
  items,
  save,
  onSaved,
}: UseCustomerFormParams) => {
  const tValidation = useTranslations("validation");
  const tErrors = useTranslations("errors");
  const [rootError, setRootError] = useState<string | null>(null);
  const [fieldIssues, setFieldIssues] = useState<Record<string, CustomerFieldIssueCode>>({});

  const isRequired = (key: "birthDate" | "acquisitionSource") =>
    items.some((item) => item.kind === "builtin" && item.key === key && item.required);

  // The form holds strings, blank when empty; the server schema takes it from there.
  const schema = z
    .object({
      customerType: z.enum(["individual", "business"]),
      email: z.email(tValidation("email")),
      firstName: z.string().trim().min(1, tValidation("required")).max(255),
      lastName: z.string().trim().min(1, tValidation("required")).max(255),
      companyName: z.string().max(255),
      companyNumber: z.string().max(64),
      vatNumber: z.string().max(64),
      phone: z
        .string()
        .refine((value) => value === "" || isPossiblePhoneNumberInput(value), tValidation("phone")),
      address: z.string(),
      city: z.string(),
      postalCode: z.string(),
      country: z.string().refine((value) => value === "" || value.length === 2),
      birthDate: z
        .string()
        .refine((value) => value === "" || isPlausibleBirthDate(value), tValidation("date")),
      acquisitionSource: z.union([z.enum(CUSTOMER_ACQUISITION_SOURCES), z.literal("")]),
      acquisitionSourceDetail: z.string().max(255),
      socialLinks: z.partialRecord(z.enum(CUSTOMER_SOCIAL_NETWORKS), z.string().max(255)),
      notes: z.string(),
      customFields: z.record(z.string(), z.string()),
    })
    .superRefine((values, ctx) => {
      if (values.customerType === "business" && values.companyName.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: tValidation("companyNameRequired"),
          path: ["companyName"],
        });
      }
      if (isRequired("birthDate") && values.birthDate === "") {
        ctx.addIssue({ code: "custom", message: tValidation("required"), path: ["birthDate"] });
      }
      if (isRequired("acquisitionSource") && values.acquisitionSource === "") {
        ctx.addIssue({
          code: "custom",
          message: tValidation("required"),
          path: ["acquisitionSource"],
        });
      }
    });

  const mutation = useMutation({
    mutationFn: async (values: CustomerFormValues) => {
      switch (save.kind) {
        case "create":
          return createCustomer(toCustomerInput(values));
        case "update":
          return updateCustomer(save.customerId, toCustomerInput(values));
        case "record":
          return updateCustomerSection(save.customerId, toCustomerRecordInput(values, items));
      }
    },
  });

  const form = useAppForm({
    defaultValues: getCustomerFormDefaults(customer, initialCustomFields, prefill),
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      setFieldIssues({});

      const result = await mutation.mutateAsync(value);

      if ("error" in result && result.error) {
        if ("fieldIssues" in result && result.fieldIssues) {
          setFieldIssues(
            Object.fromEntries(result.fieldIssues.map((issue) => [issue.definitionId, issue.code])),
          );
        }
        const key = getErrorMessageKey(result.error);
        setRootError(tErrors.has(key) ? tErrors(key) : tErrors("generic"));
        return;
      }

      const createdId =
        "customerId" in result && typeof result.customerId === "string"
          ? result.customerId
          : undefined;
      const customerId = save.kind === "create" ? createdId : save.customerId;
      if (customerId) onSaved(customerId, value);
    },
  });

  /** Starts over, e.g. when the dialog opens again with another search. */
  const reset = (nextPrefill?: CustomerFormPrefill) => {
    mutation.reset();
    setRootError(null);
    setFieldIssues({});
    form.reset(getCustomerFormDefaults(customer, initialCustomFields, nextPrefill));
  };

  return { form, rootError, fieldIssues, reset };
};

export type CustomerFormApi = ReturnType<typeof useCustomerForm>["form"];
