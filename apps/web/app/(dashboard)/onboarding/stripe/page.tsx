'use client';

import { useRouter } from 'next/navigation';

import { useStore } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import {
  CheckCircle2,
  CreditCard,
  FileCheck,
  Info,
  Loader2,
  Settings,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import { Radio, RadioGroup } from '@louez/ui';
import { Label } from '@louez/ui';
import { stripeSetupSchema } from '@louez/validations';

import { orpc } from '@/lib/orpc/react';

import { useAppForm } from '@/hooks/form/form';

function resolveErrorMessage(
  tErrors: (key: string) => string,
  error: unknown,
): string {
  if (error instanceof Error) {
    if (error.message.startsWith('errors.')) {
      return tErrors(error.message.replace('errors.', ''));
    }
    if (error.message.trim().length > 0) {
      return error.message;
    }
  }

  return tErrors('generic');
}

export default function OnboardingStripePage() {
  const router = useRouter();
  const t = useTranslations('onboarding.stripe');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');

  const completeOnboardingMutation = useMutation(
    orpc.dashboard.onboarding.complete.mutationOptions(),
  );

  const form = useAppForm({
    defaultValues: {
      reservationMode: 'request' as 'request' | 'payment',
    },
    validators: {
      onSubmit: stripeSetupSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        await completeOnboardingMutation.mutateAsync(value);
        toastManager.add({ title: t('configComplete'), type: 'success' });
        // Signal the welcome animation via sessionStorage (more reliable than URL params)
        sessionStorage.setItem('louez-show-welcome', '1');
        router.push('/dashboard');
      } catch (error) {
        toastManager.add({
          title: resolveErrorMessage(tErrors, error),
          type: 'error',
        });
      }
    },
  });

  const reservationMode = useStore(form.store, (s) => s.values.reservationMode);

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <FileCheck className="text-primary h-6 w-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form.AppForm>
          <form.Form className="space-y-6">
            {/* Reservation Mode */}
            <form.Field name="reservationMode">
              {(field) => (
                <div className="space-y-2">
                  <Label>{t('title')}</Label>
                  <RadioGroup
                    value={field.state.value}
                    onValueChange={(value) =>
                      field.handleChange(value as 'request' | 'payment')
                    }
                    className="space-y-3"
                  >
                    <Label className="border-muted bg-popover hover:bg-accent has-data-checked:border-primary has-data-checked:bg-accent/50 flex cursor-pointer items-start gap-4 rounded-lg border-2 p-4">
                      <Radio value="request" className="hidden" />
                      <div className="bg-primary/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                        <CheckCircle2 className="text-primary h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{t('requestMode')}</p>
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            {t('recommended')}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {t('requestModeDescription')}
                        </p>
                      </div>
                    </Label>
                    <Label className="border-muted bg-popover hover:bg-accent has-data-checked:border-primary has-data-checked:bg-accent/50 flex cursor-pointer items-start gap-4 rounded-lg border-2 p-4">
                      <Radio value="payment" className="hidden" />
                      <div className="bg-primary/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                        <CreditCard className="text-primary h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{t('paymentMode')}</p>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {t('paymentModeDescription')}
                        </p>
                      </div>
                    </Label>
                  </RadioGroup>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            {/* Info Box - changes based on selected mode */}
            {reservationMode === 'request' ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                <div className="flex gap-3">
                  <Info className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      {t('howItWorks')}
                    </p>
                    <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                      <li>{t('step1')}</li>
                      <li>{t('step2')}</li>
                      <li>{t('step3')}</li>
                      <li>{t('step4')}</li>
                      <li>{t('step5')}</li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/20">
                <div className="flex gap-3">
                  <Settings className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-violet-800 dark:text-violet-200">
                      {t('paymentSetupTitle')}
                    </p>
                    <p className="text-sm text-violet-700 dark:text-violet-300">
                      {t('paymentSetupDescription')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => router.push('/onboarding/branding')}
                disabled={completeOnboardingMutation.isPending}
              >
                {tCommon('back')}
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={completeOnboardingMutation.isPending}
              >
                {completeOnboardingMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {tCommon('confirm')}
              </Button>
            </div>
          </form.Form>
        </form.AppForm>
      </CardContent>
    </Card>
  );
}
