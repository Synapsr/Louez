"use client";

import { revalidateLogic } from "@tanstack/react-form";
import { z } from "zod";

import {
  CUSTOMER_FIELD_APPLIES_TO,
  CUSTOMER_FIELD_TYPES,
  type CustomerFieldDefinition,
} from "@louez/types";

import { useAppForm } from "@/hooks/form/form";

export interface CustomerFieldFormValues {
  label: string;
  type: (typeof CUSTOMER_FIELD_TYPES)[number];
  options: string[];
  unit: string;
  helpText: string;
  section: string;
  appliesTo: (typeof CUSTOMER_FIELD_APPLIES_TO)[number];
  isRequired: boolean;
  isSensitive: boolean;
  showOnContract: boolean;
  isSearchable: boolean;
  showInList: boolean;
}

interface UseCustomerFieldFormParams {
  field: CustomerFieldDefinition | null;
  defaultSection: string;
  messages: { required: string; optionsRequired: string };
  onSubmit: (values: CustomerFieldFormValues) => Promise<void>;
}

export const useCustomerFieldForm = ({
  field,
  defaultSection,
  messages,
  onSubmit,
}: UseCustomerFieldFormParams) => {
  const schema = z
    .object({
      label: z.string().trim().min(1, messages.required).max(100),
      type: z.enum(CUSTOMER_FIELD_TYPES),
      options: z.array(z.string()),
      unit: z.string().max(32),
      helpText: z.string().max(255),
      section: z.string().trim().min(1, messages.required).max(100),
      appliesTo: z.enum(CUSTOMER_FIELD_APPLIES_TO),
      isRequired: z.boolean(),
      isSensitive: z.boolean(),
      showOnContract: z.boolean(),
      isSearchable: z.boolean(),
      showInList: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (values.type === "select" && values.options.length === 0) {
        ctx.addIssue({ code: "custom", message: messages.optionsRequired, path: ["options"] });
      }
    });

  const defaultValues: CustomerFieldFormValues = {
    label: field?.label ?? "",
    type: field?.type ?? "text",
    options: field?.options ?? [],
    unit: field?.unit ?? "",
    helpText: field?.helpText ?? "",
    section: field?.section ?? defaultSection,
    appliesTo: field?.appliesTo ?? "all",
    isRequired: field?.isRequired ?? false,
    isSensitive: field?.isSensitive ?? false,
    showOnContract: field?.showOnContract ?? false,
    isSearchable: field?.isSearchable ?? false,
    showInList: field?.showInList ?? false,
  };

  return useAppForm({
    defaultValues,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
};
