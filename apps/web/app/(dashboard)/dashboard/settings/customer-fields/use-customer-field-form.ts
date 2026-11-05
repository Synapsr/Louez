"use client";

import { revalidateLogic } from "@tanstack/react-form";
import { z } from "zod";

import {
  CUSTOMER_FIELD_APPLIES_TO,
  CUSTOMER_FIELD_SCOPES,
  CUSTOMER_FIELD_TYPES,
} from "@louez/types";
import {
  customerFieldCollectModeSchema,
  customerFieldFormatSchema,
  customerFieldTargetModeSchema,
  customerFieldTargetsInputSchema,
  customerFieldWidthSchema,
} from "@louez/validations";

import { useAppForm } from "@/hooks/form/form";

import { DEFAULT_ONLINE_SETTINGS } from "./util.customer-field-online";
import {
  type CustomerFieldFormValues,
  type CustomerFieldSettingsValues,
  buildDraftValues,
} from "./util.customer-fields-builder";

/** Stable across renders: `useAppForm` resets an untouched form whenever its defaults change. */
const BLANK_VALUES = buildDraftValues({
  type: "text",
  scope: "customer",
  online: DEFAULT_ONLINE_SETTINGS,
});

interface UseCustomerFieldFormParams {
  messages: { required: string; optionsRequired: string };
  onSubmit: (values: CustomerFieldFormValues) => Promise<void>;
}

/**
 * The field being created in the Sheet. One form for the page: each new
 * draft resets it with its type, scope and starting settings, keeping these
 * blank defaults so a re-render never resets it behind the owner's back.
 */
export const useCustomerFieldForm = ({ messages, onSubmit }: UseCustomerFieldFormParams) => {
  const schema = z
    .object({
      label: z.string().trim().min(1, messages.required).max(100),
      type: z.enum(CUSTOMER_FIELD_TYPES),
      scope: z.enum(CUSTOMER_FIELD_SCOPES),
      width: customerFieldWidthSchema,
      options: z.array(z.string()),
      unit: z.string().max(32),
      helpText: z.string().max(255),
      format: customerFieldFormatSchema.nullable(),
      appliesTo: z.enum(CUSTOMER_FIELD_APPLIES_TO),
      isRequired: z.boolean(),
      isSensitive: z.boolean(),
      showOnContract: z.boolean(),
      isSearchable: z.boolean(),
      showInList: z.boolean(),
      collectMode: customerFieldCollectModeSchema,
      targetMode: customerFieldTargetModeSchema,
      targets: customerFieldTargetsInputSchema,
      customerEditable: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (values.type === "select" && values.options.length === 0) {
        ctx.addIssue({ code: "custom", message: messages.optionsRequired, path: ["options"] });
      }
    });

  return useAppForm({
    defaultValues: BLANK_VALUES,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
};

export type CustomerFieldForm = ReturnType<typeof useCustomerFieldForm>;

/** Writes the Sheet's changes into the draft form, key by key so each keeps its type. */
export const setDraftValues = (
  form: CustomerFieldForm,
  changes: Partial<CustomerFieldSettingsValues>,
) => {
  if (changes.label !== undefined) form.setFieldValue("label", changes.label);
  if (changes.helpText !== undefined) form.setFieldValue("helpText", changes.helpText);
  if (changes.options !== undefined) form.setFieldValue("options", changes.options);
  if (changes.unit !== undefined) form.setFieldValue("unit", changes.unit);
  if (changes.format !== undefined) form.setFieldValue("format", changes.format);
  if (changes.appliesTo !== undefined) form.setFieldValue("appliesTo", changes.appliesTo);
  if (changes.isRequired !== undefined) form.setFieldValue("isRequired", changes.isRequired);
  if (changes.isSensitive !== undefined) form.setFieldValue("isSensitive", changes.isSensitive);
  if (changes.showOnContract !== undefined) {
    form.setFieldValue("showOnContract", changes.showOnContract);
  }
  if (changes.isSearchable !== undefined) form.setFieldValue("isSearchable", changes.isSearchable);
  if (changes.showInList !== undefined) form.setFieldValue("showInList", changes.showInList);
  if (changes.collectMode !== undefined) form.setFieldValue("collectMode", changes.collectMode);
  if (changes.targetMode !== undefined) form.setFieldValue("targetMode", changes.targetMode);
  if (changes.targets !== undefined) form.setFieldValue("targets", changes.targets);
  if (changes.customerEditable !== undefined) {
    form.setFieldValue("customerEditable", changes.customerEditable);
  }
};
