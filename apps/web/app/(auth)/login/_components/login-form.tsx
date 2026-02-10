'use client';

import { useEffect, useMemo, useState } from 'react';

import { useMutation } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Loader2, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import { authClient } from '@louez/auth/client';
import { Alert, AlertDescription } from '@louez/ui';
import { Button } from '@louez/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import { Input } from '@louez/ui';
import { Separator } from '@louez/ui';

import { useAppForm } from '@/hooks/form/form';

import { isValidReferralCode, mapAuthErrorCodeToMessageKey } from '../utils';

interface LoginFormProps {
  callbackUrl: string;
  initialErrorCode: string | null;
  refCode: string | null;
}

function hasAuthError(result: unknown): result is { error: unknown } {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    Boolean((result as { error?: unknown }).error)
  );
}

function getAuthErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }

  return null;
}

interface AuthMutationError extends Error {
  authCode?: string;
}

function createAuthMutationError(authCode: string | null): AuthMutationError {
  const error = new Error(authCode ?? 'AUTH_DEFAULT') as AuthMutationError;
  error.authCode = authCode ?? undefined;
  return error;
}

function getMutationAuthCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'authCode' in error &&
    typeof (error as { authCode?: unknown }).authCode === 'string'
  ) {
    return (error as { authCode: string }).authCode;
  }

  return null;
}

function resolveAuthErrorMessage(
  t: (key: string) => string,
  errorCode: string | null,
): string {
  const messageKey = mapAuthErrorCodeToMessageKey(errorCode);
  return t(messageKey ?? 'errors.default');
}

export function LoginForm({
  callbackUrl,
  initialErrorCode,
  refCode,
}: LoginFormProps) {
  const t = useTranslations('auth');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const initialErrorMessage = useMemo(
    () => resolveAuthErrorMessage(t, initialErrorCode),
    [initialErrorCode, t],
  );
  const [rootError, setRootError] = useState<string | null>(
    initialErrorCode ? initialErrorMessage : null,
  );

  useEffect(() => {
    if (!initialErrorCode) {
      return;
    }

    setRootError(initialErrorMessage);
  }, [initialErrorCode, initialErrorMessage]);

  useEffect(() => {
    if (!isValidReferralCode(refCode)) {
      return;
    }

    document.cookie = `louez_referral=${refCode}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
  }, [refCode]);

  const verifyOtpMutation = useMutation({
    mutationFn: async ({ email, otp }: { email: string; otp: string }) => {
      const result = await authClient.signIn.emailOtp({
        email,
        otp,
      });

      if (result.error) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
    onSuccess: () => {
      window.location.href = callbackUrl;
    },
    onError: (error) => {
      setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
    },
  });

  const otpSchema = useMemo(
    () =>
      z.object({
        otp: z.string().length(6, t('errors.default')),
      }),
    [t],
  );

  const otpForm = useAppForm({
    defaultValues: {
      otp: '',
    },
    validators: {
      onSubmit: otpSchema,
    },
    onSubmit: ({ value }) => {
      setRootError(null);

      void verifyOtpMutation.mutateAsync({
        email: submittedEmail,
        otp: value.otp,
      });
    },
  });

  const sendOtpMutation = useMutation({
    mutationFn: async (email: string) => {
      // test error handling
      // throw new Error('test error');
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in',
      });

      if (hasAuthError(result)) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
    onSuccess: (_, email) => {
      setSubmittedEmail(email);
      setRootError(null);
      otpForm.reset();
      setOtpSent(true);
    },
    onError: (error) => {
      setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
    },
  });

  const googleSignInMutation = useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: callbackUrl,
      });
      // test error handling
      // throw new Error('test error');
      if (result.error) {
        throw createAuthMutationError(getAuthErrorCode(result.error));
      }
    },
    onError: (error) => {
      setRootError(resolveAuthErrorMessage(t, getMutationAuthCode(error)));
    },
  });

  const isPending =
    sendOtpMutation.isPending ||
    verifyOtpMutation.isPending ||
    googleSignInMutation.isPending;

  const emailSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(t('errors.default')),
      }),
    [t],
  );

  const emailForm = useAppForm({
    defaultValues: {
      email: '',
    },
    validators: {
      onSubmit: emailSchema,
    },
    onSubmit: async ({ value }) => {
      setRootError(null);

      await sendOtpMutation.mutateAsync(value.email);
    },
  });

  function handleGoogleSignIn() {
    setRootError(null);
    void googleSignInMutation.mutateAsync();
  }

  if (otpSent) {
    return (
      <Card className="border-0 shadow-none lg:border lg:shadow">
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
              <otpForm.Field name="otp">
                {(field) => (
                  <>
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="000000"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(
                          event.target.value.replace(/\D/g, '').slice(0, 6),
                        )
                      }
                      onBlur={field.handleBlur}
                      className="font-mono text-2xl tracking-[0.5em] *:h-14 *:text-center"
                      autoFocus
                      disabled={isPending}
                    />
                    <Button
                      type="submit"
                      className="h-12 w-full text-base font-medium"
                      disabled={isPending || field.state.value.length !== 6}
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('verifying')}
                        </>
                      ) : (
                        t('verify')
                      )}
                    </Button>
                  </>
                )}
              </otpForm.Field>
            </otpForm.Form>
          </otpForm.AppForm>

          <Button
            variant="outline"
            onClick={() => {
              setOtpSent(false);
              setRootError(null);
            }}
            className="w-full"
            disabled={isPending}
          >
            {t('tryDifferentEmail')}
          </Button>

          {rootError && (
            <Alert variant="error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{rootError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-none lg:border lg:shadow">
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl font-bold">{t('loginTitle')}</CardTitle>
        <CardDescription className="text-base">
          {t('loginDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Button
          variant="outline"
          className="h-12 w-full text-base font-medium"
          onClick={handleGoogleSignIn}
          disabled={isPending}
        >
          <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
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

        <emailForm.AppForm>
          <emailForm.Form className="space-y-4">
            <emailForm.AppField name="email">
              {(field) => (
                <field.Input
                  label={t('email')}
                  type="email"
                  placeholder={t('emailPlaceholder')}
                  className="*:h-12"
                />
              )}
            </emailForm.AppField>

            <Button
              type="submit"
              className="group h-12 w-full text-base font-medium"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('sending')}
                </>
              ) : (
                <>
                  {t('sendCode')}
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </Button>
          </emailForm.Form>
        </emailForm.AppForm>

        {rootError && (
          <Alert variant="error">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
