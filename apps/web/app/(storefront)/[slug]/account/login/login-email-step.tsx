"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertCircleIcon, ArrowRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { Alert, AlertDescription, Button } from "@louez/ui";

import { useAppForm } from "@/hooks/form/form";
import type { LoginErrorCode } from "@/lib/customer-auth/util.account-redirect";

import { requestLoginCode, type SendCodeError } from "../actions";

interface LoginEmailStepProps {
  storeSlug: string;
  errorCode: LoginErrorCode | null;
  onCodeSent: (email: string) => void;
}

const emailFormSchema = z.object({ email: z.email() });

/** One field, one button. Errors from the action show inline, not in a toast. */
export const LoginEmailStep = ({ storeSlug, errorCode, onCodeSent }: LoginEmailStepProps) => {
  const t = useTranslations("storefront.account");
  const tErrors = useTranslations("errors");

  const sendCode = useMutation({
    mutationFn: async (email: string) => {
      const result = await requestLoginCode({ storeSlug, email });
      if (!result.ok) throw new SendCodeFailure(result.error);
      return email;
    },
    onSuccess: onCodeSent,
  });

  const form = useAppForm({
    defaultValues: { email: "" },
    validators: { onSubmit: emailFormSchema },
    onSubmit: async ({ value }) => {
      await sendCode.mutateAsync(value.email).catch(() => undefined);
    },
  });

  const inlineError = sendCode.error
    ? sendCode.error instanceof SendCodeFailure
      ? tErrors(sendCode.error.code)
      : tErrors("generic")
    : errorCode
      ? t(`loginErrors.${errorCode}`)
      : null;

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-4">
        {inlineError ? (
          <Alert variant="error">
            <AlertCircleIcon />
            <AlertDescription>{inlineError}</AlertDescription>
          </Alert>
        ) : null}

        <form.AppField name="email">
          {(field) => (
            <field.Input
              label={t("emailAddress")}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              className="h-12 items-center text-base [&_input]:h-full [&_input]:leading-normal"
            />
          )}
        </form.AppField>

        <Button
          type="submit"
          size="xl"
          className="h-12 w-full"
          isPending={sendCode.isPending}
          pendingContent={t("sending")}
        >
          {t("sendCode")}
          <ArrowRightIcon data-slot="icon" />
        </Button>
      </form.Form>
    </form.AppForm>
  );
};

class SendCodeFailure extends Error {
  code: SendCodeError;

  constructor(code: SendCodeError) {
    super(code);
    this.code = code;
  }
}
