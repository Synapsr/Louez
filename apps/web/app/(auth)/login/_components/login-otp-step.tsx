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
    <>
      <CardHeader className="space-y-4 text-center">
        <div className="bg-primary/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full">
          <Mail className="text-primary h-8 w-8" />
        </div>
        <CardTitle className="text-2xl">{t('enterCode')}</CardTitle>
        <CardDescription className="text-base">
          {t('codeSentTo')} <strong>{submittedEmail}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <otpForm.AppForm>
          <otpForm.Form className="space-y-4">
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
      </CardContent>
    </>
  );
};
