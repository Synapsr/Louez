'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';

import { LoginErrorAlert } from './login-error-alert';
import { useOtpStep } from './use-otp-step';

interface LoginOtpStepProps {
  email: string;
  onUseDifferentEmail: () => void;
}

export const LoginOtpStep = ({
  email,
  onUseDifferentEmail,
}: LoginOtpStepProps) => {
  const t = useTranslations('auth');
  const { form, isPending, rootError } = useOtpStep({ email });

  return (
    <div className="space-y-8">
      <div className="space-y-4 text-center">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">{t('verifyEmailTitle')}</h2>
          <p className="text-muted-foreground mx-auto max-w-sm text-sm leading-relaxed text-balance">
            {t.rich('codeSentDescription', {
              email,
              strong: (chunks) => (
                <strong className="text-foreground font-semibold">
                  {chunks}
                </strong>
              ),
            })}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <form.AppForm>
            <form.Form className="space-y-6" formName="auth.login.otp">
              <form.AppField name="otp">
                {(field) => (
                  <>
                    <field.Otp
                      autoFocus
                      disabled={isPending}
                      separatorAt={3}
                      containerClassName="justify-center gap-3"
                      onComplete={() => {
                        void form.handleSubmit();
                      }}
                    />
                    <form.SubscribeButton
                      size="xl"
                      className="w-full"
                      disabled={field.state.value.length !== 6}
                    >
                      {t('verify')}
                    </form.SubscribeButton>
                  </>
                )}
              </form.AppField>
            </form.Form>
          </form.AppForm>

          <Button
            variant="ghost"
            size="xl"
            onClick={onUseDifferentEmail}
            className="w-full"
            disabled={isPending}
          >
            {t('tryDifferentEmail')}
          </Button>
        </div>

        <LoginErrorAlert message={rootError} />
      </div>
    </div>
  );
};
