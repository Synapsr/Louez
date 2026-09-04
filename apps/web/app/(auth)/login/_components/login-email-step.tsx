'use client';

import { useTranslations } from 'next-intl';

import { Button, Separator } from '@louez/ui';
import { cn } from '@louez/utils';

import { reeentRichTags } from '@/components/shared/reeent-wordmark';
import {
  REEENT_SIGNUP_ORIGIN,
  type SignupOrigin,
} from '@/lib/utils/signup-origin';

import { GoogleIcon } from './google-icon';
import { LoginErrorAlert } from './login-error-alert';
import { useEmailStep } from './use-email-step';

interface LoginEmailStepProps {
  onOtpSent: (email: string) => void;
  /** Hidden when Google OAuth is not configured on this instance. */
  showGoogle?: boolean;
  /** Present when password sign-in is also available (standalone mode). */
  onUsePassword?: () => void;
  /** Co-brands the entry screen for visitors sent here by another surface. */
  signupOrigin?: SignupOrigin | null;
}

export const LoginEmailStep = ({
  onOtpSent,
  showGoogle = true,
  onUsePassword,
  signupOrigin = null,
}: LoginEmailStepProps) => {
  const t = useTranslations('auth');
  const { form, handleGoogleSignIn, isPending, rootError } = useEmailStep({
    onOtpSent,
  });

  // Loueurs sent here by reeent need the relationship spelled out before they
  // sign up: reeent is the storefront, Louez is where rentals are run (ADR 010).
  const isFromReeent = signupOrigin === REEENT_SIGNUP_ORIGIN;

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold">
          {isFromReeent
            ? t.rich('reeentLoginTitle', reeentRichTags)
            : t('loginTitle')}
        </h2>
        <p
          className={cn(
            'text-muted-foreground mx-auto text-sm',
            isFromReeent ? 'max-w-md text-balance' : 'max-w-sm',
          )}
        >
          {isFromReeent ? t('reeentLoginDescription') : t('loginDescription')}
        </p>
      </div>
      <div className="space-y-6">
        {showGoogle && (
          <>
            <Button
              variant="outline"
              className="h-12 w-full text-base font-medium"
              onClick={handleGoogleSignIn}
              disabled={isPending}
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
          <form.Form className="space-y-2" formName="auth.login.email">
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

            <form.SubscribeButton
              size="xl"
              className="w-full"
              disabled={isPending}
            >
              {t('sendCode')}
            </form.SubscribeButton>
          </form.Form>
        </form.AppForm>

        <LoginErrorAlert message={rootError} />

        {onUsePassword && (
          <p className="text-center text-sm">
            <button
              type="button"
              onClick={onUsePassword}
              className="text-muted-foreground hover:text-primary underline underline-offset-4"
            >
              {t('usePasswordInstead')}
            </button>
          </p>
        )}
      </div>
    </div>
  );
};
