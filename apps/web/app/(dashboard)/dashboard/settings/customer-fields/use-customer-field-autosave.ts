"use client";

import { useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";

import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { customerFieldsMutations } from "./customer-fields.queries";
import {
  type CustomerFieldSettingKey,
  type CustomerFieldSettingsChanges,
  toFieldChange,
} from "./util.customer-fields-builder";

export type CustomerFieldSaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Saves one field as the owner edits it: each change goes out on its own, the
 * row shows it at once, and a refused change is put back with its reason
 * under the control that made it. Mounted per selected field, so the status
 * starts over when another one is picked.
 */
export const useCustomerFieldAutosave = (field: CustomerFieldDefinition) => {
  const tErrors = useTranslations("errors");
  const tValidation = useTranslations("validation");
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<{
    key: CustomerFieldSettingKey;
    message: string;
  } | null>(null);
  const mutation = useMutation(customerFieldsMutations.update(queryClient));

  /** Returns false when the change is refused, so a text can go back to the saved value. */
  const change = (key: CustomerFieldSettingKey, changes: CustomerFieldSettingsChanges): boolean => {
    const outcome = toFieldChange(field, key, changes);
    if (outcome.kind === "reject") {
      setFailure({
        key,
        message:
          outcome.reason === "labelRequired" ? tValidation("required") : tErrors("optionsRequired"),
      });
      return false;
    }
    setFailure(null);
    if (outcome.kind === "none") return true;
    mutation.mutate(
      { id: field.id, ...outcome.patch },
      {
        onError: (error) => {
          const messageKey = getErrorMessageKey(error);
          setFailure({
            key,
            message: tErrors.has(messageKey) ? tErrors(messageKey) : tErrors("generic"),
          });
        },
      },
    );
    return true;
  };

  const status: CustomerFieldSaveStatus = mutation.isPending
    ? "saving"
    : failure
      ? "error"
      : mutation.isSuccess
        ? "saved"
        : "idle";

  return {
    change,
    status,
    errorFor: (key: CustomerFieldSettingKey) =>
      failure?.key === key ? failure.message : undefined,
  };
};
