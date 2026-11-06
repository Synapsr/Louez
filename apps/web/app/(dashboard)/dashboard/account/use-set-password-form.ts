"use client";

import { useMemo, useState } from "react";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@louez/auth/password-policy";

import {
  createAuthMutationError,
  getMutationAuthCode,
  resolveAuthErrorMessage,
} from "@/lib/utils/util.auth-error";

import { useAppForm } from "@/hooks/form/form";

import { setPassword } from "./password-actions";

interface UseSetPasswordFormParams {
  onSuccess: () => void;
}

export const useSetPasswordForm = ({ onSuccess }: UseSetPasswordFormParams) => {
  const t = useTranslations("auth");
  const [rootError, setRootError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (newPassword: string) => {
      const result = await setPassword({ newPassword });
      if (!result.success) {
        throw createAuthMutationError(result.code);
      }
    },
  });

  const schema = useMemo(
    () =>
      z.object({
        newPassword: z
          .string()
          .min(MIN_PASSWORD_LENGTH, t("errors.passwordTooShort"))
          .max(MAX_PASSWORD_LENGTH, t("errors.passwordTooLong")),
      }),
    [t],
  );

  const form = useAppForm({
    defaultValues: { newPassword: "" },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      try {
        await mutation.mutateAsync(value.newPassword);
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
