"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import {
  createAuthMutationError,
  getMutationAuthCode,
  resolveAuthErrorMessage,
} from "@/lib/utils/util.auth-error";

import { removePassword } from "./password-actions";

interface UseRemovePasswordParams {
  onSuccess: () => void;
}

export const useRemovePassword = ({ onSuccess }: UseRemovePasswordParams) => {
  const t = useTranslations("auth");

  return useMutation({
    mutationFn: async () => {
      const result = await removePassword();
      if (!result.success) {
        throw createAuthMutationError(result.code);
      }
    },
    onSuccess,
    onError: (error) => {
      toastManager.add({
        title: resolveAuthErrorMessage(t, getMutationAuthCode(error)),
        type: "error",
      });
    },
  });
};
