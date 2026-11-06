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

import { useCallbackUrl } from "./use-callback-url";
import { rememberLastSignInMethod } from "./util.last-sign-in-method";

interface UseNewPasswordStepParams {
  email: string;
  /** The code checked on the previous screen; consumed with the new password. */
  otp: string;
}

export const useNewPasswordStep = ({ email, otp }: UseNewPasswordStepParams) => {
  const t = useTranslations("auth");
  const callbackUrl = useCallbackUrl();
  const [rootError, setRootError] = useState<string | null>(null);

  const resetPasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const reset = await authClient.emailOtp.resetPassword({
        email,
        otp,
        password,
      });
      if (reset.error) {
        throw createAuthMutationError(getAuthErrorCode(reset.error));
      }

      // The reset signs every device out and opens no session of its own.
      const signIn = await authClient.signIn.email({ email, password });
      if (signIn.error) {
        throw createAuthMutationError(getAuthErrorCode(signIn.error));
      }
    },
  });

  const passwordSchema = useMemo(
    () =>
      z.object({
        password: z
          .string()
          .min(MIN_PASSWORD_LENGTH, t("errors.passwordTooShort"))
          .max(MAX_PASSWORD_LENGTH, t("errors.passwordTooLong")),
      }),
    [t],
  );

  const form = useAppForm({
    defaultValues: {
      password: "",
    },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: {
      onSubmit: passwordSchema,
    },
    onSubmit: async ({ value }) => {
      setRootError(null);

      try {
        await resetPasswordMutation.mutateAsync(value.password);
        rememberLastSignInMethod("password");
        window.location.href = callbackUrl;
      } catch (error) {
        setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
      }
    },
  });

  return { form, isPending: resetPasswordMutation.isPending, rootError };
};
