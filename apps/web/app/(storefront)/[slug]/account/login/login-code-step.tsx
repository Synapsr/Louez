"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { AlertCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { Alert, AlertDescription, Button } from "@louez/ui";

import { useAppForm } from "@/hooks/form/form";
import { useResendCooldown } from "./use-resend-cooldown";

import {
  requestLoginCode,
  verifyLoginCode,
  type SendCodeError,
  type VerifyCodeError,
} from "../actions";

interface LoginCodeStepProps {
  storeSlug: string;
  email: string;
  onVerified: () => void;
  onChangeEmail: () => void;
}

const RESEND_COOLDOWN_SECONDS = 30;

const codeFormSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

/**
 * Six digits, auto-submitted when complete. A wrong code shows inline and
 * clears the field; "Renvoyer" waits 30 s between sends.
 */
export const LoginCodeStep = ({
  storeSlug,
  email,
  onVerified,
  onChangeEmail,
}: LoginCodeStepProps) => {
  const t = useTranslations("storefront.account");
  const tErrors = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const { secondsLeft, restart } = useResendCooldown(RESEND_COOLDOWN_SECONDS);

  const form = useAppForm({
    defaultValues: { code: "" },
    validators: { onSubmit: codeFormSchema },
    onSubmit: async ({ value }) => {
      await verify.mutateAsync(value.code).catch(() => undefined);
    },
  });

  const verify = useMutation({
    mutationFn: async (code: string) => {
      const result = await verifyLoginCode({ storeSlug, email, code });
      if (!result.ok) throw new VerifyCodeFailure(result.error);
    },
    onMutate: () => setError(null),
    onSuccess: onVerified,
    onError: (failure) => {
      setError(failure instanceof VerifyCodeFailure ? tErrors(failure.code) : tErrors("generic"));
      form.setFieldValue("code", "");
    },
  });

  const resend = useMutation({
    mutationFn: async () => {
      const result = await requestLoginCode({ storeSlug, email });
      if (!result.ok) throw new ResendFailure(result.error);
    },
    onMutate: () => {
      setError(null);
      setResent(false);
    },
    onSuccess: () => {
      setResent(true);
      restart();
    },
    onError: (failure) => {
      setError(failure instanceof ResendFailure ? tErrors(failure.code) : tErrors("generic"));
    },
  });

  const isBusy = verify.isPending || resend.isPending;

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-4">
        {error ? (
          <Alert variant="error">
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : resent ? (
          <p className="text-sm text-success">{t("newCodeSent")}</p>
        ) : null}

        <form.AppField name="code">
          {(field) => (
            <field.Otp
              autoFocus
              disabled={isBusy}
              separatorAt={3}
              containerClassName="justify-center"
              onComplete={(code) => {
                if (!verify.isPending) void verify.mutateAsync(code).catch(() => undefined);
              }}
            />
          )}
        </form.AppField>

        <Button
          type="submit"
          size="xl"
          className="h-12 w-full"
          isPending={verify.isPending}
          pendingContent={t("verifying")}
        >
          {t("verify")}
        </Button>

        <div className="flex flex-col items-center gap-1 text-sm">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 text-muted-foreground"
            disabled={isBusy || secondsLeft > 0}
            isPending={resend.isPending}
            onClick={() => resend.mutate()}
          >
            {secondsLeft > 0 ? t("resendIn", { seconds: secondsLeft }) : t("resendCode")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 text-muted-foreground"
            disabled={isBusy}
            onClick={onChangeEmail}
          >
            {t("changeEmail")}
          </Button>
        </div>
      </form.Form>
    </form.AppForm>
  );
};

class VerifyCodeFailure extends Error {
  code: VerifyCodeError;

  constructor(code: VerifyCodeError) {
    super(code);
    this.code = code;
  }
}

class ResendFailure extends Error {
  code: SendCodeError;

  constructor(code: SendCodeError) {
    super(code);
    this.code = code;
  }
}
