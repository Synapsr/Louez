"use client";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { LoginErrorAlert } from "./login-error-alert";
import { useNewPasswordStep } from "./use-new-password-step";

interface LoginNewPasswordStepProps {
  email: string;
  otp: string;
  /** Back to the e-mail screen: the way out when the code expired meanwhile. */
  onRequestNewCode: () => void;
}

export const LoginNewPasswordStep = ({
  email,
  otp,
  onRequestNewCode,
}: LoginNewPasswordStepProps) => {
  const t = useTranslations("auth");
  const { form, isPending, rootError } = useNewPasswordStep({ email, otp });

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold">{t("newPasswordTitle")}</h2>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm text-balance">
          {t("newPasswordDescription")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <form.AppForm>
            <form.Form className="space-y-4" formName="auth.login.new-password">
              <form.AppField name="password">
                {(field) => (
                  <field.Password
                    label={t("newPassword")}
                    autoComplete="new-password"
                    autoFocus
                    showRules
                    className="h-12"
                  />
                )}
              </form.AppField>

              <form.SubscribeButton size="xl" className="w-full" disabled={isPending}>
                {t("saveNewPassword")}
              </form.SubscribeButton>
            </form.Form>
          </form.AppForm>

          <Button
            variant="ghost"
            size="xl"
            onClick={onRequestNewCode}
            className="w-full"
            disabled={isPending}
          >
            {t("requestNewCode")}
          </Button>
        </div>

        <LoginErrorAlert message={rootError} />
      </div>
    </div>
  );
};
