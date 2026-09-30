"use client";

import { revalidateLogic } from "@tanstack/react-form";
import { z } from "zod";

import {
  customerFieldCollectModeSchema,
  customerFieldTargetModeSchema,
  customerFieldTargetsInputSchema,
} from "@louez/validations";

import { useAppForm } from "@/hooks/form/form";

import type { CustomerFieldOnlineSettings } from "./util.customer-field-online";

const schema = z.object({
  collectMode: customerFieldCollectModeSchema,
  targetMode: customerFieldTargetModeSchema,
  targets: customerFieldTargetsInputSchema,
  customerEditable: z.boolean(),
});

interface UseCustomerFieldTargetsFormParams {
  defaultValues: CustomerFieldOnlineSettings;
  onSubmit: (values: CustomerFieldOnlineSettings) => Promise<void>;
}

/** "Pour quels produits ?": the online settings given to every field a template just added. */
export const useCustomerFieldTargetsForm = ({
  defaultValues,
  onSubmit,
}: UseCustomerFieldTargetsFormParams) =>
  useAppForm({
    defaultValues,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
