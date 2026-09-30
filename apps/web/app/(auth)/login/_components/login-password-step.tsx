'use client';

import { useTranslations } from 'next-intl';

import { Button, Separator } from '@louez/ui';

import { useState } from 'react';

import { GoogleIcon } from '@/components/shared/google-icon';

import { LoginErrorAlert } from './login-error-alert';
import { useGoogleSignIn } from './use-google-sign-in';
import { usePasswordStep } from './use-password-step';

interface LoginPasswordStepProps {
  showGoogle: boolean;
  /**
   * False on the platform: an account is created by e-mail code or Google
   * there, and a password is only ever added to it afterwards.
   */
  allowSignUp: boolean;
  onForgotPassword: () => void;
  onUseEmailCode?: () => void;
}

export const LoginPasswordStep = ({
  showGoogle,
  allowSignUp,
  onForgotPassword,
  onUseEmailCode,
}: LoginPasswordStepProps) => {
  const t = useTranslations('auth');
  const { form, mode, toggleMode, isPending, rootError } = usePasswordStep();
  const [googleError, setGoogleError] = useState<string | null>(null);
  const google = useGoogleSignIn(setGoogleError);

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold">
          {mode === 'signUp' ? t('createAccount') : t('loginTitle')}
        </h2>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm">
          {t('passwordLoginDescription')}
        </p>
      </div>
      <div className="space-y-6">
        {showGoogle && (
          <>
            <Button
              variant="outline"
              className="h-12 w-full text-base font-medium"
              onClick={() => {
                setGoogleError(null);
                google.signIn();
              }}
              disabled={isPending || google.isPending}
            >
              <GoogleIcon className="mr-3 h-5 w-5" />
              {t('continueWithGoogle')}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card text-muted-foreground px-3">
                  {t('or')}
                </span>
              </div>
            </div>
          </>
        )}

        <form.AppForm>
          <form.Form className="space-y-2" formName="auth.login.password">
            {mode === 'signUp' && (
              <form.AppField name="name">
                {(field) => (
                  <field.Input
                    label={t('name')}
                    type="text"
                    placeholder={t('namePlaceholder')}
                    className="*:h-12"
                  />
                )}
              </form.AppField>
            )}

            <form.AppField name="email">
              {(field) => (
                <field.Input
                  label={t('email')}
                  type="email"
                  placeholder={t('emailPlaceholder')}
                  className="*:h-12"
                />
              )}
            </form.AppField>

            <form.AppField name="password">
              {(field) => (
                <field.Password
                  label={t('password')}
                  placeholder={t('passwordPlaceholder')}
                  autoComplete={
                    mode === 'signUp' ? 'new-password' : 'current-password'
                  }
                  showRules={mode === 'signUp'}
                  className="h-12"
                />
              )}
            </form.AppField>

            {mode === 'signIn' && (
              <p className="text-right text-sm">
                <button
                  type="button"
                  onClick={onForgotPassword}
                  className="text-muted-foreground hover:text-primary underline underline-offset-4"
                >
                  {t('forgotPassword')}
                </button>
              </p>
            )}

            <form.SubscribeButton
              size="xl"
              className="w-full"
              disabled={isPending}
            >
              {mode === 'signUp' ? t('createAccount') : t('login')}
            </form.SubscribeButton>
          </form.Form>
        </form.AppForm>

        <LoginErrorAlert message={rootError ?? googleError} />

        <div className="space-y-2 text-center text-sm">
          {allowSignUp && (
            <p className="text-muted-foreground">
              {mode === 'signUp' ? t('alreadyHaveAccount') : t('noAccountYet')}{' '}
              <button
                type="button"
                onClick={toggleMode}
                className="text-foreground hover:text-primary font-medium underline underline-offset-4"
              >
                {mode === 'signUp' ? t('login') : t('createAccount')}
              </button>
            </p>
          )}
          {onUseEmailCode && (
            <p>
              <button
                type="button"
                onClick={onUseEmailCode}
                className="text-muted-foreground hover:text-primary underline underline-offset-4"
              >
                {t('useEmailCodeInstead')}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
