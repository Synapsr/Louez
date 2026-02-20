'use client';

import { useCallback, useState } from 'react';

import { useRouter } from 'next/navigation';

import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { ArrowRight, KeyRound, Loader2, Mail, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import { Label } from '@louez/ui';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@louez/ui';
import { Card, CardContent } from '@louez/ui';

import { useAppForm } from '@/hooks/form/form';
import { useStorefrontUrl } from '@/hooks/use-storefront-url';

import { sendVerificationCode, verifyCode } from '../actions';

interface LoginFormProps {
  storeId: string;
  storeSlug: string;
}

export function LoginForm({ storeId, storeSlug }: LoginFormProps) {
  const router = useRouter();
  const t = useTranslations('storefront.account');
  const tErrors = useTranslations('errors');
  const { getUrl } = useStorefrontUrl(storeSlug);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const getErrorMessage = (errorKey: string) =>
    errorKey.startsWith('errors.')
      ? tErrors(errorKey.replace('errors.', ''))
      : errorKey;

  const emailSchema = z.object({
    email: z.string().email(t('codeError')),
  });

  const emailForm = useAppForm({
    defaultValues: { email: '' },
    validators: {
      onSubmit: emailSchema,
    },
    onSubmit: async ({ value }) => {
      setIsLoading(true);
      try {
        const result = await sendVerificationCode(storeId, value.email);

        if (result.error) {
          toastManager.add({ title: getErrorMessage(result.error), type: 'error' });
          return;
        }

        setEmail(value.email);
        setStep('code');
        toastManager.add({ title: t('codeSent'), type: 'success' });
      } catch {
        toastManager.add({ title: tErrors('generic'), type: 'error' });
      } finally {
        setIsLoading(false);
      }
    },
  });

  const onCodeSubmit = useCallback(
    async (codeValue: string) => {
      if (codeValue.length !== 6) return;

      setIsLoading(true);
      try {
        const result = await verifyCode(storeId, email, codeValue);

        if (result.error) {
          toastManager.add({ title: getErrorMessage(result.error), type: 'error' });
          return;
        }

        toastManager.add({ title: t('loginSuccess'), type: 'success' });
        router.push(getUrl('/account'));
        router.refresh();
      } catch {
        toastManager.add({ title: tErrors('generic'), type: 'error' });
      } finally {
        setIsLoading(false);
      }
    },
    [storeId, email, getUrl, router, t, tErrors],
  );

  const handleCodeChange = useCallback(
    (value: string) => {
      setCode(value);
      // Auto-submit when code is complete
      if (value.length === 6 && !isLoading) {
        onCodeSubmit(value);
      }
    },
    [isLoading, onCodeSubmit],
  );

  const handleResendCode = async () => {
    setIsLoading(true);
    try {
      const result = await sendVerificationCode(storeId, email);

      if (result.error) {
        toastManager.add({ title: getErrorMessage(result.error), type: 'error' });
        return;
      }

      toastManager.add({ title: t('newCodeSent'), type: 'success' });
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'code') {
    return (
      <Card className="border-0 shadow-lg">
        <CardContent className="p-6 sm:p-8">
          {/* Header */}
          <div className="mb-6 text-center">
            <div className="bg-primary/10 mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full">
              <KeyRound className="text-primary h-6 w-6" />
            </div>
            <h2 className="mb-1 text-lg font-semibold">{t('enterCode')}</h2>
            <p className="text-muted-foreground text-sm">
              {t('codeDescription')}{' '}
              <span className="text-foreground font-medium">{email}</span>
            </p>
          </div>
          <div className="space-y-6">
            <div className="flex flex-col items-center">
              <InputOTP
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                value={code}
                onChange={handleCodeChange}
                disabled={isLoading}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot
                    index={0}
                    className="h-12 w-10 text-lg sm:h-14 sm:w-12"
                  />
                  <InputOTPSlot
                    index={1}
                    className="h-12 w-10 text-lg sm:h-14 sm:w-12"
                  />
                  <InputOTPSlot
                    index={2}
                    className="h-12 w-10 text-lg sm:h-14 sm:w-12"
                  />
                  <InputOTPSlot
                    index={3}
                    className="h-12 w-10 text-lg sm:h-14 sm:w-12"
                  />
                  <InputOTPSlot
                    index={4}
                    className="h-12 w-10 text-lg sm:h-14 sm:w-12"
                  />
                  <InputOTPSlot
                    index={5}
                    className="h-12 w-10 text-lg sm:h-14 sm:w-12"
                  />
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button
              type="button"
              className="h-11 w-full"
              disabled={isLoading || code.length !== 6}
              onClick={() => onCodeSubmit(code)}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('verifying')}
                </>
              ) : (
                <>
                  {t('verify')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            <div className="flex flex-col items-center gap-3 pt-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t('resendCodeQuestion')}
                </span>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto gap-1 p-0"
                  onClick={handleResendCode}
                  disabled={isLoading}
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('resendCode')}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setStep('email');
                  setCode('');
                }}
                disabled={isLoading}
                className="text-muted-foreground"
              >
                {t('changeEmail')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-lg">
      <CardContent className="p-6 sm:p-8">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="bg-primary/10 mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full">
            <Mail className="text-primary h-6 w-6" />
          </div>
          <h2 className="mb-1 text-lg font-semibold">{t('yourEmail')}</h2>
          <p className="text-muted-foreground text-sm">
            {t('loginDescription')}
          </p>
        </div>
        <emailForm.AppForm>
          <emailForm.Form className="space-y-6">
            <emailForm.AppField name="email">
              {(field) => (
                <field.Input
                  label={t('emailAddress')}
                  type="email"
                  placeholder={t('emailPlaceholder')}
                />
              )}
            </emailForm.AppField>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('sending')}
                </>
              ) : (
                <>
                  {t('sendCode')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </emailForm.Form>
        </emailForm.AppForm>
      </CardContent>
    </Card>
  );
}
