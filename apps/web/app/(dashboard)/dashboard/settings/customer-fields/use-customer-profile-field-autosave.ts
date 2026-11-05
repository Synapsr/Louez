"use client";

import { useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { CustomerProfileFieldKey } from "@louez/types";

import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { customerFieldsMutations } from "./customer-fields.queries";
import type { CustomerFieldSaveStatus } from "./use-customer-field-autosave";
import type { CustomerProfileFieldPatch } from "./util.customer-profile-field-settings";

/** Which control a change came from, to put its error right under it. */
export type CustomerProfileFieldSettingKey = "shown" | "required" | "online";

/**
 * Saves a Louez profile field as the owner edits it, like a store field: each
 * change goes out on its own, the row shows it at once, and a refused one
 * is put back with its reason under the control that made it. Mounted per
 * selected field, so the status starts over when another one is picked.
 */
export const useCustomerProfileFieldAutosave = (field: CustomerProfileFieldKey) => {
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<{
    key: CustomerProfileFieldSettingKey;
    message: string;
  } | null>(null);
  const mutation = useMutation(customerFieldsMutations.updateProfileField(queryClient));

  const change = (key: CustomerProfileFieldSettingKey, patch: CustomerProfileFieldPatch) => {
    setFailure(null);
    if (Object.keys(patch).length === 0) return;
    mutation.mutate(
      { field, ...patch },
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
    errorFor: (key: CustomerProfileFieldSettingKey) =>
      failure?.key === key ? failure.message : undefined,
  };
};
