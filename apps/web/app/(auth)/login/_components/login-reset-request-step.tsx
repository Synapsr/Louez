"use client";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { LoginErrorAlert } from "./login-error-alert";
import { useResetRequestStep } from "./use-reset-request-step";

interface LoginResetRequestStepProps {
  /**
   * False on an instance without SMTP (self-host): the code is not e-mailed,
   * it is printed in the server logs, and the screen has to say so.
   */
  emailDelivery: boolean;
  onCodeSent: (email: string) => void;
  onBack: () => void;
}

export const LoginResetRequestStep = ({
  emailDelivery,
  onCodeSent,
  onBack,
}: LoginResetRequestStepProps) => {
  const t = useTranslations("auth");
  const { form, isPending, rootError } = useResetRequestStep({ onCodeSent });

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold">{t("forgotPasswordTitle")}</h2>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm text-balance">
          {emailDelivery ? t("forgotPasswordDescription") : t("forgotPasswordLogsDescription")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <form.AppForm>
            <form.Form className="space-y-2" formName="auth.login.reset-request">
              <form.AppField name="email">
                {(field) => (
                  <field.Input
                    label={t("email")}
                    type="email"
                    autoComplete="email"
                    placeholder={t("emailPlaceholder")}
                    className="*:h-12"
                  />
                )}
              </form.AppField>

              <form.SubscribeButton size="xl" className="w-full" disabled={isPending}>
                {t("sendCode")}
              </form.SubscribeButton>
            </form.Form>
          </form.AppForm>

          <Button
            variant="ghost"
            size="xl"
            onClick={onBack}
            className="w-full"
            disabled={isPending}
          >
            {t("backToLogin")}
          </Button>
        </div>

        <LoginErrorAlert message={rootError} />
      </div>
    </div>
  );
};
