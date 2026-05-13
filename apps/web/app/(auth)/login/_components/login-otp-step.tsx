'use client';

import { Mail } from 'lucide-react';

import {
  Button,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';

import { LoginErrorAlert } from './login-error-alert';
import type { LoginFormState } from './use-login-form';

interface LoginOtpStepProps {
  state: LoginFormState;
}

export const LoginOtpStep = ({ state }: LoginOtpStepProps) => {
  const {
    handleUseDifferentEmail,
    isPending,
    otpForm,
    rootError,
    submittedEmail,
    t,
  } = state;

  return (
    <div className="space-y-6 px-4">
      <div className="space-y-3 text-center">
        <div className="bg-primary/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full">
          <Mail className="text-primary h-8 w-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">{t('enterCode')}</h2>
          <p className="text-muted-foreground text-base">
            {t('codeSentTo')} <strong>{submittedEmail}</strong>
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <otpForm.AppForm>
          <otpForm.Form className="space-y-6" formName="auth.login.otp">
            <otpForm.AppField name="otp">
              {(field) => (
                <>
                  <field.Otp
                    autoFocus
                    disabled={isPending}
                    containerClassName="justify-center"
                    onComplete={() => {
                      void otpForm.handleSubmit();
                    }}
                  />
                  <Button
                    type="submit"
                    size="xl"
                    className="w-full"
                    disabled={field.state.value.length !== 6}
                    isPending={isPending}
                  >
                    {t('verify')}
                  </Button>
                </>
              )}
            </otpForm.AppField>
          </otpForm.Form>
        </otpForm.AppForm>

        <Button
          variant="outline"
          onClick={handleUseDifferentEmail}
          className="w-full"
          disabled={isPending}
        >
          {t('tryDifferentEmail')}
        </Button>

        <LoginErrorAlert message={rootError} />
      </div>
    </div>
  );
};
