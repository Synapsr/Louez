"use client";

import { useMemo, useState } from "react";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { authClient } from "@louez/auth/client";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@louez/auth/password-policy";

import {
  createAuthMutationError,
  getAuthErrorCode,
  getMutationAuthCode,
  resolveAuthErrorMessage,
} from "@/lib/utils/util.auth-error";

import { useAppForm } from "@/hooks/form/form";

interface ChangePasswordValues {
  currentPassword: string;
  newPassword: string;
}

interface UseChangePasswordFormParams {
  onSuccess: () => void;
}

export const useChangePasswordForm = ({ onSuccess }: UseChangePasswordFormParams) => {
  const t = useTranslations("auth");
  const [rootError, setRootError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ currentPassword, newPassword }: ChangePasswordValues) => {
      // The server forces `revokeOtherSessions` whatever is sent; saying it
      // here keeps the intent readable where the call is made.
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
  });

  const schema = useMemo(
    () =>
      z.object({
        currentPassword: z.string().min(1, t("errors.currentPasswordRequired")),
        newPassword: z
          .string()
          .min(MIN_PASSWORD_LENGTH, t("errors.passwordTooShort"))
          .max(MAX_PASSWORD_LENGTH, t("errors.passwordTooLong")),
      }),
    [t],
  );

  const form = useAppForm({
    defaultValues: { currentPassword: "", newPassword: "" } satisfies ChangePasswordValues,
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      try {
        await mutation.mutateAsync(value);
        onSuccess();
      } catch (error) {
        setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
      }
    },
  });

  const reset = () => {
    form.reset();
    setRootError(null);
  };

  return { form, rootError, reset };
};
