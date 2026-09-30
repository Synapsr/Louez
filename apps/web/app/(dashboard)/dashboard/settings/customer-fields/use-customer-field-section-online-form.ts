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

interface UseCustomerFieldSectionOnlineFormParams {
  defaultValues: CustomerFieldOnlineSettings;
  onSubmit: (values: CustomerFieldOnlineSettings) => Promise<void>;
}

/** The three "Réservation en ligne" controls of a whole section. */
export const useCustomerFieldSectionOnlineForm = ({
  defaultValues,
  onSubmit,
}: UseCustomerFieldSectionOnlineFormParams) =>
  useAppForm({
    defaultValues,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
