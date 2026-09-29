"use client";

import { useMemo, useState } from "react";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { authClient } from "@louez/auth/client";

import {
  createAuthMutationError,
  getAuthErrorCode,
  getMutationAuthCode,
  hasAuthError,
  resolveAuthErrorMessage,
} from "@/lib/utils/util.auth-error";

import { useAppForm } from "@/hooks/form/form";

interface UseResetRequestStepParams {
  onCodeSent: (email: string) => void;
}

export const useResetRequestStep = ({ onCodeSent }: UseResetRequestStepParams) => {
  const t = useTranslations("auth");
  const [rootError, setRootError] = useState<string | null>(null);

  // The endpoint answers "success" whether or not the address has an account,
  // so moving on to the code screen never reveals which addresses exist.
  const requestResetMutation = useMutation({
    mutationFn: async (email: string) => {
      const result = await authClient.emailOtp.requestPasswordReset({ email });

      if (hasAuthError(result)) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
  });

  const emailSchema = useMemo(
    () =>
      z.object({
        email: z.email(t("errors.invalidEmail")),
      }),
    [t],
  );

  const form = useAppForm({
    defaultValues: {
      email: "",
    },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: {
      onSubmit: emailSchema,
    },
    onSubmit: async ({ value }) => {
      setRootError(null);

      try {
        await requestResetMutation.mutateAsync(value.email);
        onCodeSent(value.email);
      } catch (error) {
        setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
      }
    },
  });

  return { form, isPending: requestResetMutation.isPending, rootError };
};
