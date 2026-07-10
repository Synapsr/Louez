'use client';

import { useRouter } from 'next/navigation';

import { CheckCircle2, CreditCard, Info, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { Radio, RadioGroup } from '@louez/ui';
import { Label } from '@louez/ui';

import { OnboardingStepHeader } from '../_components/step-header';
import { useStripeStep } from './use-stripe-step';

export function OnboardingStripeClientPage({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const t = useTranslations('onboarding.stripe');
  const tCommon = useTranslations('common');
  const { form, reservationMode, isPending } = useStripeStep({ nextPath });

  return (
    <>
      <OnboardingStepHeader title={t('title')} description={t('description')} />
      <form.AppForm>
        <form.Form className="space-y-6">
          {/* Reservation Mode */}
          <form.Field name="reservationMode">
            {(field) => (
              <div className="space-y-2">
                <RadioGroup
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as 'request' | 'payment')
                  }
                  className="space-y-3"
                >
                  <Label className="hover:bg-accent/30 has-data-checked:border-foreground/30 has-data-checked:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors">
                    <Radio value="request" className="hidden" />
                    <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <CheckCircle2 className="size-4" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">
                          {t('requestMode')}
                        </p>
                        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                          {t('recommended')}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {t('requestModeDescription')}
                      </p>
                    </div>
                  </Label>
                  <Label className="hover:bg-accent/30 has-data-checked:border-foreground/30 has-data-checked:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors">
                    <Radio value="payment" className="hidden" />
                    <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <CreditCard className="size-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t('paymentMode')}</p>
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
            <div className="bg-muted/40 rounded-xl border p-4">
              <div className="flex gap-3">
                <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t('howItWorks')}</p>
                  <ul className="text-muted-foreground space-y-1 text-sm">
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
            <div className="bg-muted/40 rounded-xl border p-4">
              <div className="flex gap-3">
                <Settings className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">
                    {t('paymentSetupTitle')}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {t('paymentSetupDescription')}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push('/onboarding/branding')}
              disabled={isPending}
            >
              {tCommon('back')}
            </Button>
            <form.SubscribeButton className="flex-1">
              {tCommon('confirm')}
            </form.SubscribeButton>
          </div>
        </form.Form>
      </form.AppForm>
    </>
  );
}
